import {
  rubricScoringFor,
  taskWeightingView,
  weightingMetadata,
} from './diagnostic-result-policy.store';
import { refreshFourSkillResult } from './diagnostic-four-skill.store';
import {
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
import { Interval } from '@nestjs/schedule';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import {
  classifyDiagnosticTask,
  type DiagnosticQuestionForScoring,
} from './diagnostic.logic';
import {
  assessWritingLength,
  DIAGNOSTIC_RUBRIC_GRADER,
  type DiagnosticRubricGrader,
  gradeWithRubric,
  parseRubric,
} from './diagnostic-productive';
import { selectDiagnosticRubricGrader } from './diagnostic-rubric-grader';

const DIAGNOSTIC_WRITING_QUEUE = 'breadtrans-diagnostic-writing';
const DIAGNOSTIC_WRITING_JOB = 'diagnostic-writing-grade';
const GRADER_VERSION = 'diagnostic-writing-v2-rubric';

/** The learner-facing shape returned in results. */
export type DiagnosticWritingFeedback = {
  questionId: number;
  status: 'QUEUED' | 'GRADING' | 'GRADED' | 'GRADING_FAILED';
  answer: string;
  /** Percentage of the rubric range (0-100) once GRADED; null otherwise. */
  score: number | null;
  scoreScale?: 'PERCENT_0_100';
  /** A criterion is null when it could not be assessed. */
  criteria?: Record<string, number | null> | null;
  criterionFeedback?: Record<string, string> | null;
  rubricVersion?: string | null;
  weightingVersion?: string | null;
  criterionWeights?: Record<string, number> | null;
  unavailableCriteria?: string[];
  limitedEvidence?: boolean;
  wordCount?: number | null;
  feedback: string | null;
  suggestions: string[];
  provider: string | null;
  failureReason: string | null;
  gradedAt: string | null;
};

/**
 * `run` is the row's gradingAttempts at enqueue time. Every grading run
 * increments it, so a job whose run no longer matches is stale and cannot
 * claim or write the row.
 */
type DiagnosticWritingJob = { responseId: number; run: number };

/** A QUEUED row older than this whose job is not waiting or running is stranded. */
const STRANDED_QUEUED_AFTER_MS = 5 * 60_000;
const LIVE_JOB_STATES = new Set([
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
]);

type WritingRow = Awaited<
  ReturnType<PrismaService['diagnosticWritingResponse']['findUnique']>
>;

@Injectable()
export class DiagnosticWritingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiagnosticWritingService.name);
  private queue?: Queue<DiagnosticWritingJob>;
  private worker?: Worker<DiagnosticWritingJob>;
  private queueConnection?: IORedis;
  private workerConnection?: IORedis;
  private readonly grader: DiagnosticRubricGrader;

  constructor(
    private readonly prisma: PrismaService,
    aiService: AiService,
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
    this.worker.on('failed', (job, error) => {
      if (job)
        void this.markRunFailed(job.data, `WORKER_FAILED: ${error.message}`);
    });
    void this.recoverStrandedQueued();
  }

  /**
   * After a database restore the queue can still hold a finished job with the
   * id a restored QUEUED row expects (jobs are kept 7 days), so enqueueing it
   * again is a silent no-op and the row would wait forever; retry() only
   * accepts GRADING_FAILED. A QUEUED row whose job is not waiting or running
   * gets a new run, exactly as retry() would, and any old job of it is stale.
   */
  @Interval(STRANDED_QUEUED_AFTER_MS)
  async recoverStrandedQueued(now = Date.now()): Promise<number> {
    if (!this.queue) return 0;
    try {
      const rows = await this.prisma.diagnosticWritingResponse.findMany({
        where: {
          status: 'QUEUED',
          submittedAt: { lt: new Date(now - STRANDED_QUEUED_AFTER_MS) },
        },
        select: { id: true, gradingAttempts: true },
        take: 50,
      });
      let requeued = 0;
      for (const row of rows) {
        const job = await this.queue.getJob(
          `diagnostic-writing-${row.id}-${row.gradingAttempts}`,
        );
        const state = job ? await job.getState() : 'missing';
        if (LIVE_JOB_STATES.has(state)) continue;
        const nextRun = row.gradingAttempts + 1;
        const moved = await this.prisma.diagnosticWritingResponse.updateMany({
          where: {
            id: row.id,
            status: 'QUEUED',
            gradingAttempts: row.gradingAttempts,
          },
          data: { gradingAttempts: nextRun },
        });
        if (moved.count === 0) continue;
        await this.enqueue(row.id, nextRun);
        requeued += 1;
        this.logger.warn(
          `Writing response ${row.id} was QUEUED with no live job (${state}); requeued as run ${nextRun}`,
        );
      }
      return requeued;
    } catch (error) {
      this.logger.warn(
        `Stranded Writing queue check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
  }

  /**
   * Queue the Writing responses of a just-completed attempt, after commit.
   *
   * The rows normally exist already: the submit transaction creates them
   * (`createRowsForAttempt`) so no reader ever sees a completed attempt
   * without its Writing rows. Any missing row is created here, then every
   * QUEUED row gets one job per run; a replayed completion queues nothing new.
   */
  async enqueueForAttempt(
    attempt: {
      id: number;
      userId: number;
      assessmentId: number;
      answers: unknown;
    },
    questions: DiagnosticQuestionForScoring[],
  ) {
    await this.createRowsForAttempt(this.prisma, attempt, questions);
    const rows = await this.prisma.diagnosticWritingResponse.findMany({
      where: { attemptId: attempt.id, status: 'QUEUED' },
      orderBy: { questionId: 'asc' },
    });
    for (const row of rows) await this.enqueue(row.id, row.gradingAttempts);
  }

  /**
   * Persist the Writing responses of an attempt being completed.
   *
   * Transition: (none) -> QUEUED, once per (attempt, task). The text is the
   * one submitted with the attempt, which is final from then on. A row that
   * already exists is left alone. `db` is the submit transaction when called
   * from there, so the rows commit together with the COMPLETED status.
   */
  async createRowsForAttempt(
    db: Pick<
      Prisma.TransactionClient,
      'diagnosticWritingResponse' | 'diagnosticRubric'
    >,
    attempt: {
      id: number;
      userId: number;
      assessmentId: number;
      answers: unknown;
    },
    questions: DiagnosticQuestionForScoring[],
  ) {
    const answers =
      attempt.answers &&
      typeof attempt.answers === 'object' &&
      !Array.isArray(attempt.answers)
        ? (attempt.answers as Record<string, unknown>)
        : {};
    for (const question of questions) {
      if (classifyDiagnosticTask(question) !== 'WRITING') continue;
      const raw = answers[String(question.id)];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const responseText = raw.trim();
      const length = assessWritingLength(
        responseText,
        question.wordMin,
        question.wordMax,
      );
      const rubric = question.rubricId
        ? await db.diagnosticRubric.findUnique({
            where: { id: question.rubricId },
          })
        : null;
      const existing = await db.diagnosticWritingResponse.findUnique({
        where: {
          attemptId_questionId: {
            attemptId: attempt.id,
            questionId: question.id,
          },
        },
      });
      if (existing) continue;
      try {
        await db.diagnosticWritingResponse.create({
          data: {
            userId: attempt.userId,
            assessmentId: attempt.assessmentId,
            attemptId: attempt.id,
            questionId: question.id,
            taskKey: this.taskKeyOf(question),
            status: 'QUEUED',
            responseText,
            wordCount: length.wordCount,
            rubricId: rubric?.id ?? null,
            rubricVersion: rubric?.rubricVersion ?? null,
            graderVersion: GRADER_VERSION,
            gradingAttempts: 1,
            submittedAt: new Date(),
          },
        });
      } catch (error) {
        // A concurrent completion created it first: that one owns the run.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          continue;
        throw error;
      }
    }
  }

  private async enqueue(responseId: number, run: number) {
    try {
      if (!this.queue) throw new Error('Writing grading queue is unavailable');
      // One job per run: a duplicate add for the same run is a no-op.
      await this.queue.add(
        DIAGNOSTIC_WRITING_JOB,
        { responseId, run },
        { jobId: `diagnostic-writing-${responseId}-${run}` },
      );
    } catch (error) {
      await this.prisma.diagnosticWritingResponse.updateMany({
        where: { id: responseId, gradingAttempts: run, status: 'QUEUED' },
        data: {
          status: 'GRADING_FAILED',
          failureReason:
            error instanceof Error
              ? error.message
              : 'Không thể xếp hàng chấm Writing',
        },
      });
    }
  }

  /**
   * Re-grade a Writing response whose grading failed.
   *
   * Preconditions: the attempt is the caller's on this assessment; the task is
   * a Writing task; its response is GRADING_FAILED. Transition GRADING_FAILED
   * -> QUEUED with the run number incremented, conditionally, so two
   * concurrent retries queue exactly one run and any older job goes stale.
   */
  async retry(
    userId: number,
    assessmentId: number,
    attemptId: number,
    questionId: number,
  ) {
    const attempt = await this.prisma.diagnosticAttempt.findUnique({
      where: { id: attemptId },
      select: { userId: true, assessmentId: true },
    });
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.assessmentId !== assessmentId
    )
      throw new ForbiddenException('Bản nộp không thuộc tài khoản này');
    const question = await this.prisma.diagnosticQuestion.findFirst({
      where: { id: questionId, assessmentId },
    });
    if (!question || classifyDiagnosticTask(question) !== 'WRITING')
      throw new NotFoundException('Nhiệm vụ Writing không tồn tại');
    const row = await this.prisma.diagnosticWritingResponse.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
    });
    if (!row || row.userId !== userId || !row.responseText)
      throw new NotFoundException('Không có bài viết hợp lệ để chấm lại');
    if (row.status !== 'GRADING_FAILED')
      throw new ConflictException(
        'Bài viết này không ở trạng thái chấm lại được',
      );
    const nextRun = row.gradingAttempts + 1;
    const flipped = await this.prisma.diagnosticWritingResponse.updateMany({
      where: {
        id: row.id,
        status: 'GRADING_FAILED',
        gradingAttempts: row.gradingAttempts,
      },
      data: { status: 'QUEUED', gradingAttempts: nextRun, failureReason: null },
    });
    if (flipped.count === 0)
      throw new ConflictException(
        'Bài viết này không ở trạng thái chấm lại được',
      );
    await this.enqueue(row.id, nextRun);
    return { questionId, status: 'QUEUED' as const };
  }

  /** Results read the dedicated table; legacy JSON feedback is the fallback. */
  async listFeedback(attemptId: number): Promise<DiagnosticWritingFeedback[]> {
    const rows = await this.prisma.diagnosticWritingResponse.findMany({
      where: { attemptId },
      orderBy: { questionId: 'asc' },
    });
    return rows.map((row) => this.toFeedback(row));
  }

  private toFeedback(row: NonNullable<WritingRow>): DiagnosticWritingFeedback {
    const meta =
      row.scoreMetadata && typeof row.scoreMetadata === 'object'
        ? (row.scoreMetadata as Record<string, unknown>)
        : {};
    const graded = row.status === 'GRADED';
    const status = ['QUEUED', 'GRADING', 'GRADED', 'GRADING_FAILED'].includes(
      row.status,
    )
      ? (row.status as DiagnosticWritingFeedback['status'])
      : 'QUEUED';
    return {
      questionId: row.questionId,
      status,
      answer: row.responseText ?? '',
      score: graded ? row.score : null,
      scoreScale: 'PERCENT_0_100',
      criteria: graded
        ? ((meta.criteria as Record<string, number | null>) ?? null)
        : null,
      criterionFeedback: graded
        ? ((meta.criterionFeedback as Record<string, string>) ?? null)
        : null,
      rubricVersion: row.rubricVersion,
      ...taskWeightingView('WRITING', graded, meta),
      wordCount: row.wordCount,
      feedback: graded ? ((meta.feedback as string) ?? null) : null,
      suggestions:
        graded && Array.isArray(meta.suggestions)
          ? (meta.suggestions as string[])
          : [],
      provider: row.provider,
      failureReason: row.failureReason,
      gradedAt: row.gradedAt ? row.gradedAt.toISOString() : null,
    };
  }

  private taskKeyOf(question: { id: number; options: unknown }) {
    const raw = question.options as { stableKey?: unknown } | null;
    return String(
      typeof raw?.stableKey === 'string' ? raw.stableKey : question.id,
    );
  }

  private markRunFailed(job: DiagnosticWritingJob, reason: string) {
    return this.prisma.diagnosticWritingResponse.updateMany({
      where: {
        id: job.responseId,
        gradingAttempts: job.run,
        status: { in: ['QUEUED', 'GRADING'] },
      },
      data: { status: 'GRADING_FAILED', score: null, failureReason: reason },
    });
  }

  async process(job: Pick<Job<DiagnosticWritingJob>, 'data'>) {
    try {
      await this.gradeDiagnosticWritingJob(job);
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
      const row = await this.prisma.diagnosticWritingResponse.findUnique({
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

  private async gradeDiagnosticWritingJob(
    job: Pick<Job<DiagnosticWritingJob>, 'data'>,
  ) {
    const { responseId, run } = job.data;
    const claimed = await this.prisma.diagnosticWritingResponse.updateMany({
      where: { id: responseId, status: 'QUEUED', gradingAttempts: run },
      data: { status: 'GRADING' },
    });
    // Stale run or duplicate delivery: someone else owns the row.
    if (claimed.count === 0) return;
    const finish = (
      data: Prisma.DiagnosticWritingResponseUpdateManyMutationInput,
    ) =>
      this.prisma.diagnosticWritingResponse.updateMany({
        where: { id: responseId, status: 'GRADING', gradingAttempts: run },
        data,
      });
    const fail = (
      reason: string,
      extra: Prisma.DiagnosticWritingResponseUpdateManyMutationInput = {},
    ) =>
      finish({
        status: 'GRADING_FAILED',
        score: null,
        failureReason: reason,
        ...extra,
      });

    const row = await this.prisma.diagnosticWritingResponse.findUnique({
      where: { id: responseId },
    });
    if (!row?.responseText) {
      await fail('Không có bài viết để chấm');
      return;
    }
    const question = await this.prisma.diagnosticQuestion.findUnique({
      where: { id: row.questionId },
    });
    if (!question || classifyDiagnosticTask(question) !== 'WRITING') {
      await fail('Nhiệm vụ Writing không còn tồn tại');
      return;
    }
    const rubricRow = row.rubricId
      ? await this.prisma.diagnosticRubric.findUnique({
          where: { id: row.rubricId },
        })
      : null;
    let rubric: ReturnType<typeof parseRubric>;
    try {
      if (!rubricRow) throw new Error('RUBRIC_MISSING');
      rubric = parseRubric(rubricRow);
      if (rubric.skill !== 'WRITING') throw new Error('RUBRIC_SKILL_MISMATCH');
    } catch (error) {
      await fail(error instanceof Error ? error.message : 'RUBRIC_INVALID');
      return;
    }

    const scoring = await rubricScoringFor(this.prisma, row.attemptId);
    const outcome = await gradeWithRubric(
      this.grader,
      {
        skill: 'WRITING',
        submissionRef: `writing:${row.id}:${run}`,
        rubric,
        taskPrompt: question.question,
        taskInstructions: question.instructions ?? null,
        responseText: row.responseText,
        writingLength: assessWritingLength(
          row.responseText,
          question.wordMin,
          question.wordMax,
        ),
      },
      scoring,
    );
    if (outcome.status === 'GRADED') {
      await finish({
        status: 'GRADED',
        score: outcome.grade.taskPercentage,
        scoreMetadata: {
          validated: true,
          rubricVersion: rubric.version,
          criteria: outcome.grade.criteria,
          criterionFeedback: outcome.grade.criterionFeedback,
          feedback: outcome.grade.feedback,
          suggestions: outcome.grade.suggestions,
          evidenceQuotes: outcome.grade.evidenceQuotes,
          ...weightingMetadata(outcome.grade),
        },
        rawProviderPayload: this.asJson(outcome.raw),
        provider: this.grader.providerFor?.('WRITING') ?? this.grader.provider,
        providerVersion: this.grader.providerVersion,
        failureReason: null,
        gradedAt: new Date(),
      });
    } else {
      this.logger.warn(`Diagnostic Writing grading failed: ${outcome.reason}`);
      await fail(outcome.reason, {
        provider: this.grader.providerFor?.('WRITING') ?? this.grader.provider,
        providerVersion: this.grader.providerVersion,
        scoreMetadata: { validated: false, rejection: outcome.reason },
        rawProviderPayload: this.asJson(outcome.raw),
      });
    }
  }

  private asJson(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull;
    if (typeof value === 'string') return { text: value.slice(0, 20_000) };
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      return Prisma.JsonNull;
    }
  }
}
