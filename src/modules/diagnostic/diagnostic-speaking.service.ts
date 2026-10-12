import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { UploadService } from '../upload/upload.service';
import { AiService } from '../ai/ai.service';
import { MockSpeakingEvaluator } from '../speaking/mock-speaking-evaluator';
import { getQuestionMeta, isOpenDiagnosticQuestion } from './diagnostic.logic';
import { DiagnosticSpeakingAudioNormalizer } from './diagnostic-speaking-audio-normalizer';

const MAX_BYTES = 10 * 1024 * 1024;
const MIN_DURATION_MS = 300;
const MAX_DURATION_MS = 90_000;
const ALLOWED_MIME = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
]);

type AudioFile = Express.Multer.File;

const DIAGNOSTIC_SPEAKING_QUEUE = 'breadtrans-diagnostic-speaking';
const DIAGNOSTIC_SPEAKING_JOB = 'diagnostic-speaking-grade';

type DiagnosticSpeakingJob = { responseId: number; audioKey: string };

@Injectable()
export class DiagnosticSpeakingService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DiagnosticSpeakingService.name);
  private queue?: Queue<DiagnosticSpeakingJob>;
  private worker?: Worker<DiagnosticSpeakingJob>;
  private queueConnection?: IORedis;
  private workerConnection?: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly aiService: AiService,
    @Optional()
    private readonly audioNormalizer?: DiagnosticSpeakingAudioNormalizer,
  ) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.queueConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.workerConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.queue = new Queue<DiagnosticSpeakingJob>(DIAGNOSTIC_SPEAKING_QUEUE, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 7 * 86400, count: 200 },
        removeOnFail: { age: 7 * 86400, count: 200 },
      },
    });
    this.worker = new Worker<DiagnosticSpeakingJob>(
      DIAGNOSTIC_SPEAKING_QUEUE,
      async (job) => this.processGradingJob(job),
      { connection: this.workerConnection, concurrency: 2 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
  }

  private async loadContext(
    userId: number,
    assessmentId: number,
    attemptId: number,
    questionId: number,
  ) {
    const attempt = await this.prisma.diagnosticAttempt.findUnique({
      where: { id: attemptId },
      include: { speakingResponses: true },
    });
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.assessmentId !== assessmentId
    ) {
      throw new ForbiddenException('Phiên kiểm tra không thuộc tài khoản này');
    }
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Phiên kiểm tra đã hoàn tất');
    }
    const question = await this.prisma.diagnosticQuestion.findFirst({
      where: { id: questionId, assessmentId },
    });
    if (
      !question ||
      !isOpenDiagnosticQuestion(question) ||
      getQuestionMeta(question).section !== 'SPEAKING'
    ) {
      throw new NotFoundException('Nhiệm vụ Speaking không tồn tại');
    }
    return { attempt, question };
  }

  async confirmRecording(
    userId: number,
    assessmentId: number,
    attemptId: number,
    questionId: number,
    file: AudioFile,
    durationMs?: number,
  ) {
    const { attempt, question } = await this.loadContext(
      userId,
      assessmentId,
      attemptId,
      questionId,
    );
    if (!file?.buffer?.length) throw new BadRequestException('Bản ghi rỗng');
    if (file.size > MAX_BYTES)
      throw new BadRequestException('Bản ghi vượt quá 10MB');
    const mime = (file.mimetype || '').toLowerCase();
    if (
      ![...ALLOWED_MIME].some(
        (allowed) => mime === allowed || mime.startsWith(`${allowed};`),
      )
    ) {
      throw new BadRequestException('Định dạng bản ghi không được hỗ trợ');
    }
    const actualDuration = Number(durationMs);
    if (
      !Number.isFinite(actualDuration) ||
      actualDuration < MIN_DURATION_MS ||
      actualDuration > MAX_DURATION_MS
    ) {
      throw new BadRequestException('Thời lượng bản ghi không hợp lệ');
    }

    const existing = attempt.speakingResponses.find(
      (r) => r.questionId === questionId,
    );
    const extension = mime.includes('wav')
      ? 'wav'
      : mime.includes('ogg')
        ? 'ogg'
        : mime.includes('mp4')
          ? 'm4a'
          : 'webm';
    const audioKey = `premium/speaking/diagnostic/${assessmentId}/${attemptId}/${questionId}/${randomUUID()}.${extension}`;
    await this.uploadService.putPrivateObjectAtKey(
      audioKey,
      file.buffer,
      mime || 'audio/webm',
    );

    const response = await this.prisma.diagnosticSpeakingResponse.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: {
        userId,
        assessmentId,
        attemptId,
        questionId,
        taskKey: String(
          (getQuestionMeta(question) as { stableKey?: string }).stableKey ??
            questionId,
        ),
        status: 'QUEUED',
        audioKey,
        audioMimeType: mime,
        byteSize: file.size,
        durationMs: actualDuration,
        transcript: null,
        score: null,
        scoreMetadata: Prisma.JsonNull,
        provider: null,
        graderVersion: 'diagnostic-speaking-v1',
        gradingAttempts: 0,
        failureReason: null,
        confirmedAt: new Date(),
        gradedAt: null,
      },
      update: {
        status: 'QUEUED',
        audioKey,
        audioMimeType: mime,
        byteSize: file.size,
        durationMs: actualDuration,
        transcript: null,
        score: null,
        scoreMetadata: Prisma.JsonNull,
        provider: null,
        graderVersion: 'diagnostic-speaking-v1',
        gradingAttempts: 0,
        failureReason: null,
        confirmedAt: new Date(),
        gradedAt: null,
      },
    });
    if (existing?.audioKey && existing.audioKey !== audioKey) {
      await this.uploadService
        .deleteFile(existing.audioKey)
        .catch(() => undefined);
    }
    try {
      if (!this.queue) {
        throw new Error('Diagnostic speaking grading queue is unavailable');
      }
      await this.queue.add(
        DIAGNOSTIC_SPEAKING_JOB,
        { responseId: response.id, audioKey },
        { jobId: `diagnostic-speaking-${response.id}-${Date.now()}` },
      );
    } catch (error) {
      const failed = await this.prisma.diagnosticSpeakingResponse.update({
        where: { id: response.id },
        data: {
          status: 'GRADING_FAILED',
          failureReason:
            error instanceof Error
              ? error.message
              : 'Không thể xếp hàng chấm tự động',
        },
      });
      return this.publicResponse(failed);
    }
    return this.publicResponse(response);
  }

  async skip(
    userId: number,
    assessmentId: number,
    attemptId: number,
    questionId: number,
  ) {
    const { question } = await this.loadContext(
      userId,
      assessmentId,
      attemptId,
      questionId,
    );
    const response = await this.prisma.diagnosticSpeakingResponse.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: {
        userId,
        assessmentId,
        attemptId,
        questionId,
        taskKey: String(
          (getQuestionMeta(question) as { stableKey?: string }).stableKey ??
            questionId,
        ),
        status: 'SKIPPED',
        confirmedAt: new Date(),
      },
      update: {
        status: 'SKIPPED',
        score: null,
        failureReason: null,
        confirmedAt: new Date(),
      },
    });
    return this.publicResponse(response);
  }

  async list(userId: number, assessmentId: number, attemptId: number) {
    const attempt = await this.prisma.diagnosticAttempt.findUnique({
      where: { id: attemptId },
    });
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.assessmentId !== assessmentId
    ) {
      throw new ForbiddenException('Phiên kiểm tra không thuộc tài khoản này');
    }
    const rows = await this.prisma.diagnosticSpeakingResponse.findMany({
      where: { attemptId },
      orderBy: { questionId: 'asc' },
    });
    return rows.map((row) => this.publicResponse(row));
  }

  async audio(userId: number, responseId: number) {
    const response = await this.prisma.diagnosticSpeakingResponse.findUnique({
      where: { id: responseId },
    });
    if (!response || response.userId !== userId)
      throw new ForbiddenException('Không có quyền truy cập bản ghi');
    if (!response.audioKey)
      throw new NotFoundException('Bản ghi chưa có audio');
    return {
      url: await this.uploadService.getPrivatePresignedDownloadUrl(
        response.audioKey,
        300,
      ),
    };
  }

  private async grade(targetText: string, buffer: Buffer) {
    let lastError = 'Không thể chấm tự động';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = MockSpeakingEvaluator.isMockEnabled()
          ? await MockSpeakingEvaluator.evaluate(targetText, buffer)
          : await this.aiService.assessPronunciation(targetText, buffer);
        if (result.isSilentOrNoSpeech || result.errorCode === 'NO_SPEECH') {
          return {
            status: 'GRADING_FAILED',
            score: null,
            transcript: result.transcript ?? null,
            metadata: result,
            provider: MockSpeakingEvaluator.isMockEnabled() ? 'mock' : 'azure',
            attempts: attempt,
            failureReason: 'Không phát hiện giọng nói',
          };
        }
        const raw = Number(result.overallScore);
        const score = Math.max(0, Math.min(100, raw <= 10 ? raw * 10 : raw));
        return {
          status: 'GRADED',
          score,
          transcript: result.transcript ?? null,
          metadata: result,
          provider: MockSpeakingEvaluator.isMockEnabled() ? 'mock' : 'azure',
          attempts: attempt,
          failureReason: null,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === 2) break;
      }
    }
    return {
      status: 'GRADING_FAILED',
      score: null,
      transcript: null,
      metadata: { errorCode: 'PROVIDER_UNAVAILABLE' },
      provider: 'unavailable',
      attempts: 2,
      failureReason: lastError,
    };
  }

  private async processGradingJob(job: Job<DiagnosticSpeakingJob>) {
    const claimed = await this.prisma.diagnosticSpeakingResponse.updateMany({
      where: {
        id: job.data.responseId,
        audioKey: job.data.audioKey,
        status: 'QUEUED',
      },
      data: { status: 'GRADING' },
    });
    if (claimed.count === 0) return;
    const response = await this.prisma.diagnosticSpeakingResponse.findUnique({
      where: { id: job.data.responseId },
    });
    if (!response || response.audioKey !== job.data.audioKey) return;
    if (!response.audioKey) {
      await this.prisma.diagnosticSpeakingResponse.updateMany({
        where: {
          id: response.id,
          audioKey: job.data.audioKey,
          status: 'GRADING',
        },
        data: {
          status: 'GRADING_FAILED',
          failureReason: 'Bản ghi không có đối tượng âm thanh lưu trữ',
        },
      });
      return;
    }
    const question = await this.prisma.diagnosticQuestion.findUnique({
      where: { id: response.questionId },
      select: { question: true },
    });
    if (!question) {
      await this.prisma.diagnosticSpeakingResponse.updateMany({
        where: {
          id: response.id,
          audioKey: job.data.audioKey,
          status: 'GRADING',
        },
        data: {
          status: 'GRADING_FAILED',
          failureReason: 'Nhiệm vụ Speaking không còn tồn tại',
        },
      });
      return;
    }
    let originalBuffer: Buffer;
    let normalized: Awaited<
      ReturnType<DiagnosticSpeakingAudioNormalizer['normalize']>
    >;
    try {
      originalBuffer = await this.uploadService.downloadPrivateFileBuffer(
        response.audioKey,
      );
      normalized = await (
        this.audioNormalizer ?? new DiagnosticSpeakingAudioNormalizer()
      ).normalize(originalBuffer, response.audioMimeType ?? 'audio/webm');
    } catch (error) {
      await this.prisma.diagnosticSpeakingResponse.updateMany({
        where: {
          id: response.id,
          audioKey: job.data.audioKey,
          status: 'GRADING',
        },
        data: {
          status: 'GRADING_FAILED',
          score: null,
          scoreMetadata: { errorCode: 'AUDIO_NORMALIZATION_FAILED' },
          provider: 'unavailable',
          gradingAttempts: { increment: 1 },
          failureReason:
            error instanceof Error
              ? error.message
              : 'Không thể chuẩn hóa âm thanh',
        },
      });
      return;
    }
    try {
      const gradingStartedAt = Date.now();
      const scoreState = await this.grade(question.question, normalized.buffer);
      this.logger.log(
        JSON.stringify({
          event: 'diagnostic_speaking_provider_result',
          provider: scoreState.provider,
          providerDurationMs: Date.now() - gradingStartedAt,
          resultStatus: scoreState.status,
        }),
      );
      await this.prisma.diagnosticSpeakingResponse.updateMany({
        where: {
          id: response.id,
          audioKey: job.data.audioKey,
          status: 'GRADING',
        },
        data: {
          status: scoreState.status,
          transcript: scoreState.transcript,
          score: scoreState.score,
          scoreMetadata: scoreState.metadata as Prisma.InputJsonObject,
          provider: scoreState.provider,
          gradingAttempts: scoreState.attempts,
          failureReason: scoreState.failureReason,
          gradedAt: scoreState.status === 'GRADED' ? new Date() : null,
        },
      });
    } catch (error) {
      await this.prisma.diagnosticSpeakingResponse.updateMany({
        where: {
          id: response.id,
          audioKey: job.data.audioKey,
          status: 'GRADING',
        },
        data: {
          status: 'GRADING_FAILED',
          gradingAttempts: { increment: 1 },
          failureReason:
            error instanceof Error ? error.message : 'Không thể chấm tự động',
        },
      });
    }
  }

  private publicResponse(row: {
    id: number;
    questionId: number;
    taskKey: string;
    status: string;
    audioMimeType: string | null;
    byteSize: number | null;
    durationMs: number | null;
    transcript: string | null;
    score: number | null;
    provider: string | null;
    graderVersion: string | null;
    gradingAttempts: number;
    failureReason: string | null;
    confirmedAt: Date | null;
    gradedAt: Date | null;
  }) {
    return {
      id: row.id,
      questionId: row.questionId,
      taskKey: row.taskKey,
      status: row.status,
      audioMimeType: row.audioMimeType,
      byteSize: row.byteSize,
      durationMs: row.durationMs,
      transcript: row.transcript,
      score: row.score,
      provider: row.provider,
      graderVersion: row.graderVersion,
      gradingAttempts: row.gradingAttempts,
      failureReason: row.failureReason,
      confirmedAt: row.confirmedAt,
      gradedAt: row.gradedAt,
    };
  }
}
