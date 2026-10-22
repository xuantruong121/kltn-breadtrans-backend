import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { getQuestionMeta, isOpenDiagnosticQuestion } from './diagnostic.logic';

const DIAGNOSTIC_WRITING_QUEUE = 'breadtrans-diagnostic-writing';
const DIAGNOSTIC_WRITING_JOB = 'diagnostic-writing-grade';

export type DiagnosticWritingFeedback = {
  questionId: number;
  status: 'QUEUED' | 'GRADING' | 'GRADED' | 'GRADING_FAILED';
  answer: string;
  score: number | null;
  feedback: string | null;
  suggestions: string[];
  provider: string | null;
  failureReason: string | null;
  gradedAt: string | null;
};

type DiagnosticWritingJob = {
  attemptId: number;
  questionId: number;
  prompt: string;
  answer: string;
};

type AnswerMap = Record<string, unknown>;

@Injectable()
export class DiagnosticWritingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiagnosticWritingService.name);
  private queue?: Queue<DiagnosticWritingJob>;
  private worker?: Worker<DiagnosticWritingJob>;
  private queueConnection?: IORedis;
  private workerConnection?: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
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
    this.queue = new Queue<DiagnosticWritingJob>(DIAGNOSTIC_WRITING_QUEUE, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 7 * 86400, count: 200 },
        removeOnFail: { age: 7 * 86400, count: 200 },
      },
    });
    this.worker = new Worker<DiagnosticWritingJob>(
      DIAGNOSTIC_WRITING_QUEUE,
      async (job) => this.process(job),
      { connection: this.workerConnection, concurrency: 1 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
  }

  private answerMap(value: unknown): AnswerMap {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as AnswerMap)
      : {};
  }

  private feedbackMap(
    answers: AnswerMap,
  ): Record<string, DiagnosticWritingFeedback> {
    const value = answers.__writingFeedback;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, DiagnosticWritingFeedback>)
      : {};
  }

  private async updateFeedback(
    attemptId: number,
    questionId: number,
    patch: Partial<DiagnosticWritingFeedback>,
  ) {
    const attempt = await this.prisma.diagnosticAttempt.findUnique({
      where: { id: attemptId },
      select: { answers: true },
    });
    if (!attempt) throw new NotFoundException('Bản nộp không tồn tại');
    const answers = this.answerMap(attempt.answers);
    const feedback = this.feedbackMap(answers);
    const previous = feedback[String(questionId)];
    answers.__writingFeedback = {
      ...feedback,
      [String(questionId)]: { ...previous, questionId, ...patch },
    };
    await this.prisma.diagnosticAttempt.update({
      where: { id: attemptId },
      data: { answers: answers as Prisma.InputJsonValue },
    });
  }

  async enqueueMany(
    attemptId: number,
    items: Array<{ questionId: number; prompt: string; answer: string }>,
  ) {
    for (const item of items) {
      await this.updateFeedback(attemptId, item.questionId, {
        status: 'QUEUED',
        answer: item.answer,
        score: null,
        feedback: null,
        suggestions: [],
        provider: null,
        failureReason: null,
        gradedAt: null,
      });
      try {
        if (!this.queue)
          throw new Error('Writing grading queue is unavailable');
        await this.queue.add(DIAGNOSTIC_WRITING_JOB, { attemptId, ...item });
      } catch (error) {
        await this.updateFeedback(attemptId, item.questionId, {
          status: 'GRADING_FAILED',
          failureReason:
            error instanceof Error
              ? error.message
              : 'Không thể xếp hàng chấm Writing',
        });
      }
    }
  }

  async retry(
    userId: number,
    assessmentId: number,
    attemptId: number,
    questionId: number,
  ) {
    const attempt = await this.prisma.diagnosticAttempt.findUnique({
      where: { id: attemptId },
      include: { assessment: { include: { questions: true } } },
    });
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.assessmentId !== assessmentId
    )
      throw new ForbiddenException('Bản nộp không thuộc tài khoản này');
    const question = attempt.assessment.questions.find(
      (item) => item.id === questionId,
    );
    if (
      !question ||
      !isOpenDiagnosticQuestion(question) ||
      getQuestionMeta(question).section !== 'WRITING'
    )
      throw new NotFoundException('Nhiệm vụ Writing không tồn tại');
    const answer = this.answerMap(attempt.answers)[String(questionId)];
    if (typeof answer !== 'string' || answer.trim().length < 2)
      throw new NotFoundException('Không có bài viết hợp lệ để chấm lại');
    await this.enqueueMany(attemptId, [
      { questionId, prompt: question.question, answer: answer.trim() },
    ]);
    return { questionId, status: 'QUEUED' as const };
  }

  private async process(job: Job<DiagnosticWritingJob>) {
    await this.updateFeedback(job.data.attemptId, job.data.questionId, {
      status: 'GRADING',
    });
    try {
      const result = await this.aiService.evaluateWritingPart3(
        job.data.prompt,
        job.data.answer,
      );
      const score = Math.max(0, Math.min(5, Number(result.score)));
      if (!Number.isFinite(score))
        throw new Error('Điểm Writing từ AI không hợp lệ');
      await this.updateFeedback(job.data.attemptId, job.data.questionId, {
        status: 'GRADED',
        score,
        feedback:
          String(result.feedback || '').trim() ||
          'Đã hoàn tất nhận xét bài viết.',
        suggestions: Array.isArray(result.suggestions)
          ? result.suggestions.map(String).slice(0, 3)
          : [],
        provider: 'ai',
        failureReason: null,
        gradedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`Diagnostic Writing grading failed: ${String(error)}`);
      await this.updateFeedback(job.data.attemptId, job.data.questionId, {
        status: 'GRADING_FAILED',
        provider: 'ai',
        failureReason:
          'Chưa thể tạo nhận xét tự động. Bạn có thể thử chấm lại sau.',
      });
    }
  }
}
