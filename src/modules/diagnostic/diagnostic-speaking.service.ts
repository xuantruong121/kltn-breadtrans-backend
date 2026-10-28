import {
  rubricScoringFor,
  taskWeightingView,
  weightingMetadata,
} from './diagnostic-result-policy.store';
import { refreshFourSkillResult } from './diagnostic-four-skill.store';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
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
import { classifyDiagnosticTask } from './diagnostic.logic';
import { DiagnosticSpeakingAudioNormalizer } from './diagnostic-speaking-audio-normalizer';
import {
  checkRecordingDuration,
  DIAGNOSTIC_RUBRIC_GRADER,
  type DiagnosticRubricGrader,
  gradeWithRubric,
  parseRubric,
  speakingDurationPolicy,
} from './diagnostic-productive';
import { selectDiagnosticRubricGrader } from './diagnostic-rubric-grader';

const MAX_BYTES = 10 * 1024 * 1024;
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
const GRADER_VERSION = 'diagnostic-speaking-v2-rubric';

/**
 * The audioKey is the grading-run identity: it is unique per confirmed
 * recording, so a job for an older recording can never claim or overwrite the
 * row once a newer recording has replaced it.
 */
type DiagnosticSpeakingJob = { responseId: number; audioKey: string };

const DURATION_MESSAGES: Record<string, string> = {
  TOO_SHORT: 'Bản ghi quá ngắn',
  TOO_LONG: 'Bản ghi dài hơn thời gian cho phép của nhiệm vụ',
  CLIENT_DURATION_MISMATCH:
    'Thời lượng bản ghi không khớp với nội dung âm thanh',
};

@Injectable()
export class DiagnosticSpeakingService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DiagnosticSpeakingService.name);
  private queue?: Queue<DiagnosticSpeakingJob>;
  private worker?: Worker<DiagnosticSpeakingJob>;
  private queueConnection?: IORedis;
  private workerConnection?: IORedis;
  private readonly grader: DiagnosticRubricGrader;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    aiService: AiService,
    @Optional()
    private readonly audioNormalizer?: DiagnosticSpeakingAudioNormalizer,
    @Optional()
    @Inject(DIAGNOSTIC_RUBRIC_GRADER)
    grader?: DiagnosticRubricGrader,
  ) {
    this.grader = grader ?? selectDiagnosticRubricGrader(aiService);
  }

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
    // A job that crashed or stalled must not leave its row in GRADING
    // forever, where neither the learner nor retry can reach it.
    this.worker.on('failed', (job, error) => {
      if (job)
        void this.markRunFailed(job.data, `WORKER_FAILED: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
  }

  private async loadAttempt(
    userId: number,
    assessmentId: number,
    attemptId: number,
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
    return attempt;
  }

  private async loadSpeakingTask(assessmentId: number, questionId: number) {
    const question = await this.prisma.diagnosticQuestion.findFirst({
      where: { id: questionId, assessmentId },
    });
    if (!question || classifyDiagnosticTask(question) !== 'SPEAKING') {
      throw new NotFoundException('Nhiệm vụ Speaking không tồn tại');
    }
    return question;
  }

  private async loadContext(
    userId: number,
    assessmentId: number,
    attemptId: number,
    questionId: number,
  ) {
    const attempt = await this.loadAttempt(userId, assessmentId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Phiên kiểm tra đã hoàn tất');
    }
    const question = await this.loadSpeakingTask(assessmentId, questionId);
    return { attempt, question };
  }

  private taskKeyOf(question: { id: number; options: unknown }) {
    const raw = question.options as { stableKey?: unknown } | null;
    return String(
      typeof raw?.stableKey === 'string' ? raw.stableKey : question.id,
    );
  }

  /**
   * Accept a recording for one Speaking task.
   *
   * Transition: (none | QUEUED | GRADING | GRADED | GRADING_FAILED | SKIPPED)
   * -> QUEUED, allowed only while the attempt is IN_PROGRESS. Re-recording is
   * the same transition: the new recording replaces the old one, and the old
   * recording's job becomes stale because its audioKey no longer matches.
   */
  async confirmRecording(
    userId: number,
    assessmentId: number,
    attemptId: number,
    questionId: number,
    file: AudioFile,
    durationMs?: number,
  ) {
    const { question } = await this.loadContext(
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

    // The limit is the task's own response time, and the duration judged is
    // the one DECODED from the audio, not the one the client reports.
    let policy: ReturnType<typeof speakingDurationPolicy>;
    try {
      policy = speakingDurationPolicy(question);
    } catch {
      throw new NotFoundException('Nhiệm vụ Speaking chưa được cấu hình');
    }
    let measuredMs: number;
    try {
      const decoded = await (
        this.audioNormalizer ?? new DiagnosticSpeakingAudioNormalizer()
      ).normalize(file.buffer, mime);
      measuredMs = decoded.durationMs;
    } catch {
      throw new BadRequestException('Không đọc được nội dung bản ghi âm');
    }
    const clientMs =
      durationMs === undefined || durationMs === null
        ? undefined
        : Number(durationMs);
    const verdict = checkRecordingDuration(policy, measuredMs, clientMs);
    if (!verdict.ok) {
      // Both figures, so a refused recording can be diagnosed from the log.
      this.logger.warn(
        JSON.stringify({
          event: 'diagnostic_speaking_duration_refused',
          code: verdict.code,
          attemptId,
          questionId,
          measuredMs,
          clientMs: clientMs ?? null,
          maxMs: policy.maxMs,
          mime,
        }),
      );
      throw new BadRequestException(DURATION_MESSAGES[verdict.code]);
    }

    const rubric = question.rubricId
      ? await this.prisma.diagnosticRubric.findUnique({
          where: { id: question.rubricId },
        })
      : null;
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

    let replacedKey: string | null = null;
    let response: Awaited<
      ReturnType<PrismaService['diagnosticSpeakingResponse']['upsert']>
    >;
    try {
      response = await this.prisma.$transaction(async (tx) => {
        // Serialize confirmations for this task, and re-check the attempt
        // under the lock: the upload above can take long enough for the
        // learner to submit, and a recording arriving after submission must
        // not replace the one that was submitted.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`diagnostic:speaking:${attemptId}:${questionId}`}, 0))`;
        const current = await tx.diagnosticAttempt.findUnique({
          where: { id: attemptId },
          select: { status: true },
        });
        if (current?.status !== 'IN_PROGRESS') {
          throw new BadRequestException('Phiên kiểm tra đã hoàn tất');
        }
        const existing = await tx.diagnosticSpeakingResponse.findUnique({
          where: { attemptId_questionId: { attemptId, questionId } },
          select: { audioKey: true },
        });
        replacedKey = existing?.audioKey ?? null;
        const fields = {
          status: 'QUEUED',
          audioKey,
          audioMimeType: mime,
          byteSize: file.size,
          durationMs: verdict.durationMs,
          transcript: null,
          score: null,
          scoreMetadata: Prisma.JsonNull,
          provider: null,
          providerVersion: null,
          graderVersion: GRADER_VERSION,
          rubricId: rubric?.id ?? null,
          rubricVersion: rubric?.rubricVersion ?? null,
          gradingAttempts: 0,
          failureReason: null,
          confirmedAt: new Date(),
          gradedAt: null,
        };
        return tx.diagnosticSpeakingResponse.upsert({
          where: { attemptId_questionId: { attemptId, questionId } },
          create: {
            userId,
            assessmentId,
            attemptId,
            questionId,
            taskKey: this.taskKeyOf(question),
            ...fields,
          },
          update: fields,
        });
      });
    } catch (error) {
      // The recording was refused: do not leave its object behind.
      await this.uploadService.deleteFile(audioKey).catch(() => undefined);
      throw error;
    }
    if (replacedKey && replacedKey !== audioKey) {
      await this.uploadService.deleteFile(replacedKey).catch(() => undefined);
    }
    return this.enqueue(response, audioKey);
  }

  private async enqueue(
    response: Parameters<DiagnosticSpeakingService['publicResponse']>[0] & {
      id: number;
    },
    audioKey: string,
  ) {
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
      await this.prisma.diagnosticSpeakingResponse.updateMany({
        where: { id: response.id, audioKey, status: 'QUEUED' },
        data: {
          status: 'GRADING_FAILED',
          failureReason:
            error instanceof Error
              ? error.message
              : 'Không thể xếp hàng chấm tự động',
        },
      });
      const failed = await this.prisma.diagnosticSpeakingResponse.findUnique({
        where: { id: response.id },
      });
      return this.publicResponse(failed ?? response);
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
        taskKey: this.taskKeyOf(question),
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

  /**
   * Re-grade a recording whose grading failed, keeping the same recording.
   *
   * Preconditions: the attempt is the caller's on this assessment; the task's
   * response exists, is GRADING_FAILED and still has its audio. Allowed after
   * the attempt is COMPLETED, because the recording no longer changes then.
   * The status flip is conditional, so two concurrent retries enqueue once.
   */
  async retry(
    userId: number,
    assessmentId: number,
    attemptId: number,
    questionId: number,
  ) {
    await this.loadAttempt(userId, assessmentId, attemptId);
    await this.loadSpeakingTask(assessmentId, questionId);
    const row = await this.prisma.diagnosticSpeakingResponse.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
    });
    if (!row || row.userId !== userId)
      throw new NotFoundException('Không có bản ghi để chấm lại');
    if (row.status !== 'GRADING_FAILED' || !row.audioKey)
      throw new ConflictException(
        'Bản ghi này không ở trạng thái chấm lại được',
      );
    const flipped = await this.prisma.diagnosticSpeakingResponse.updateMany({
      where: { id: row.id, audioKey: row.audioKey, status: 'GRADING_FAILED' },
      data: { status: 'QUEUED', failureReason: null },
    });
    if (flipped.count === 0)
      throw new ConflictException(
        'Bản ghi này không ở trạng thái chấm lại được',
      );
    return this.enqueue(
      { ...row, status: 'QUEUED', failureReason: null },
      row.audioKey,
    );
  }

  async list(userId: number, assessmentId: number, attemptId: number) {
    await this.loadAttempt(userId, assessmentId, attemptId);
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

  /** Leave a terminal, retryable state - only if this run still owns the row. */
  private markRunFailed(job: DiagnosticSpeakingJob, reason: string) {
    return this.prisma.diagnosticSpeakingResponse.updateMany({
      where: {
        id: job.responseId,
        audioKey: job.audioKey,
        status: { in: ['QUEUED', 'GRADING'] },
      },
      data: { status: 'GRADING_FAILED', score: null, failureReason: reason },
    });
  }

  async processGradingJob(job: Pick<Job<DiagnosticSpeakingJob>, 'data'>) {
    try {
      await this.gradeDiagnosticSpeakingJob(job);
    } finally {
      await this.syncFourSkill(job.data.responseId);
    }
  }

  /**
   * FOUR_SKILL_PLACEMENT_V2 attempts keep their per-skill rows and overall
   * in step with grading. A failure here is logged, never thrown: the
   * result is recomputed again whenever it is read.
   */
  private async syncFourSkill(responseId: number) {
    try {
      const row = await this.prisma.diagnosticSpeakingResponse.findUnique({
        where: { id: responseId },
        select: { attemptId: true },
      });
      if (row) await refreshFourSkillResult(this.prisma, row.attemptId);
    } catch (error) {
      this.logger.warn(
        `Four-skill result refresh failed for response ${responseId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async gradeDiagnosticSpeakingJob(
    job: Pick<Job<DiagnosticSpeakingJob>, 'data'>,
  ) {
    const claimed = await this.prisma.diagnosticSpeakingResponse.updateMany({
      where: {
        id: job.data.responseId,
        audioKey: job.data.audioKey,
        status: 'QUEUED',
      },
      data: { status: 'GRADING' },
    });
    // Stale (re-recorded, skipped) or duplicate job: nothing to do.
    if (claimed.count === 0) return;
    const fail = (reason: string, extra: Record<string, unknown> = {}) =>
      this.prisma.diagnosticSpeakingResponse.updateMany({
        where: {
          id: job.data.responseId,
          audioKey: job.data.audioKey,
          status: 'GRADING',
        },
        data: {
          status: 'GRADING_FAILED',
          score: null,
          failureReason: reason,
          ...extra,
        },
      });

    const response = await this.prisma.diagnosticSpeakingResponse.findUnique({
      where: { id: job.data.responseId },
    });
    if (!response || response.audioKey !== job.data.audioKey) return;
    const question = await this.prisma.diagnosticQuestion.findUnique({
      where: { id: response.questionId },
    });
    if (!question) {
      await fail('Nhiệm vụ Speaking không còn tồn tại');
      return;
    }
    const rubricRow = question.rubricId
      ? await this.prisma.diagnosticRubric.findUnique({
          where: { id: question.rubricId },
        })
      : null;
    let rubric: ReturnType<typeof parseRubric>;
    try {
      if (!rubricRow) throw new Error('RUBRIC_MISSING');
      rubric = parseRubric(rubricRow);
      if (rubric.skill !== 'SPEAKING') throw new Error('RUBRIC_SKILL_MISMATCH');
    } catch (error) {
      await fail(error instanceof Error ? error.message : 'RUBRIC_INVALID');
      return;
    }

    let normalized: Awaited<
      ReturnType<DiagnosticSpeakingAudioNormalizer['normalize']>
    >;
    try {
      const original = await this.uploadService.downloadPrivateFileBuffer(
        job.data.audioKey,
      );
      normalized = await (
        this.audioNormalizer ?? new DiagnosticSpeakingAudioNormalizer()
      ).normalize(original, response.audioMimeType ?? 'audio/webm');
    } catch (error) {
      await fail(
        error instanceof Error ? error.message : 'Không thể chuẩn hóa âm thanh',
        {
          scoreMetadata: { errorCode: 'AUDIO_NORMALIZATION_FAILED' },
          provider: 'unavailable',
        },
      );
      return;
    }

    // The attempt's persisted result policy decides how the grade becomes a
    // task percentage; older attempts keep the plain rubric mean.
    const scoring = await rubricScoringFor(this.prisma, response.attemptId);
    const startedAt = Date.now();
    const outcome = await gradeWithRubric(
      this.grader,
      {
        skill: 'SPEAKING',
        submissionRef: `speaking:${response.id}:${job.data.audioKey}`,
        rubric,
        taskPrompt: question.question,
        taskInstructions: question.instructions ?? null,
        audio: normalized.buffer,
        durationMs: normalized.durationMs,
      },
      scoring,
    );
    this.logger.log(
      JSON.stringify({
        event: 'diagnostic_speaking_rubric_result',
        provider: this.grader.provider,
        providerDurationMs: Date.now() - startedAt,
        resultStatus: outcome.status,
      }),
    );
    if (outcome.status === 'GRADED') {
      await this.prisma.diagnosticSpeakingResponse.updateMany({
        where: {
          id: response.id,
          audioKey: job.data.audioKey,
          status: 'GRADING',
        },
        data: {
          status: 'GRADED',
          transcript: outcome.grade.transcript,
          score: outcome.grade.taskPercentage,
          scoreMetadata: {
            validated: true,
            rubricVersion: rubric.version,
            criteria: outcome.grade.criteria,
            criterionFeedback: outcome.grade.criterionFeedback,
            feedback: outcome.grade.feedback,
            suggestions: outcome.grade.suggestions,
            evidenceQuotes: outcome.grade.evidenceQuotes,
            speechEvidence: (outcome.grade.speechEvidence ??
              null) as Prisma.InputJsonValue | null,
            measuredDurationMs: normalized.durationMs,
            ...weightingMetadata(outcome.grade),
          },
          provider: this.grader.provider,
          providerVersion: this.grader.providerVersion,
          rubricId: rubric.id,
          rubricVersion: rubric.version,
          gradingAttempts: outcome.attempts,
          failureReason: null,
          gradedAt: new Date(),
        },
      });
    } else {
      await fail(outcome.reason, {
        provider: this.grader.provider,
        providerVersion: this.grader.providerVersion,
        gradingAttempts: outcome.attempts,
        scoreMetadata: { validated: false, rejection: outcome.reason },
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
    scoreMetadata?: unknown;
    provider: string | null;
    graderVersion: string | null;
    rubricVersion?: string | null;
    gradingAttempts: number;
    failureReason: string | null;
    confirmedAt: Date | null;
    gradedAt: Date | null;
  }) {
    const meta =
      row.scoreMetadata && typeof row.scoreMetadata === 'object'
        ? (row.scoreMetadata as Record<string, unknown>)
        : {};
    // The storage key is deliberately absent: audio is reached only through
    // the ownership-checked `audio` endpoint and a short-lived signed URL.
    return {
      id: row.id,
      questionId: row.questionId,
      taskKey: row.taskKey,
      status: row.status,
      audioMimeType: row.audioMimeType,
      byteSize: row.byteSize,
      durationMs: row.durationMs,
      transcript: row.transcript,
      score: row.status === 'GRADED' ? row.score : null,
      criteria: row.status === 'GRADED' ? (meta.criteria ?? null) : null,
      criterionFeedback:
        row.status === 'GRADED' ? (meta.criterionFeedback ?? null) : null,
      feedback: row.status === 'GRADED' ? (meta.feedback ?? null) : null,
      ...taskWeightingView('SPEAKING', row.status === 'GRADED', meta),
      provider: row.provider,
      graderVersion: row.graderVersion,
      rubricVersion: row.rubricVersion ?? null,
      gradingAttempts: row.gradingAttempts,
      failureReason: row.failureReason,
      confirmedAt: row.confirmedAt,
      gradedAt: row.gradedAt,
    };
  }
}
