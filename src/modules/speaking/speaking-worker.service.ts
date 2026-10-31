import { randomUUID } from 'node:crypto';
import { maxRecordingMs, speakingTaskTiming } from './speaking-task-timing';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { MockSpeakingEvaluator } from './mock-speaking-evaluator';

import { UploadService } from '../upload/upload.service';
import { validateSpeakingAudio } from './speaking-audio-validator';
import {
  assessPracticeSpeech,
  mockPracticeSpeech,
} from './speaking-assessment-mode';
import {
  isMissingStorageError,
  SPEAKING_FAILED_EVENT,
  SPEAKING_COMPLETED_EVENT,
  getSpeakingPipelineMode,
  getLeaseTimeoutMs,
  getSpeakingWorkerConfig,
} from './speaking.constants';
import { SpeakingQueueService } from './speaking-queue.service';
import { LearnerProgressService } from '../learning-path/learner-progress.service';
import { SpeakingEventPublisherService } from './speaking-event-publisher.service';
import { SpeakingPostProcessingService } from './speaking-post-processing.service';

const POST_PROCESSING_MAX_ATTEMPTS = 4;
/** A legacy feedback/reward failure is retried for this long, then FAILED. */
const POST_PROCESSING_RETRY_WINDOW_MS = 2 * 60_000;
/** Minimum gap between two legacy feedback/reward attempts on one row. */
const POST_PROCESSING_RETRY_BACKOFF_MS = 30_000;

/**
 * The legacy poller mocks only when MOCK_AZURE_SPEECH=true is set explicitly
 * outside unit tests (which stub AiService) and never in production.
 */
const legacyMockEnabled = () =>
  process.env.MOCK_AZURE_SPEECH === 'true' &&
  process.env.NODE_ENV !== 'test' &&
  MockSpeakingEvaluator.isMockEnabled();

const MAX_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = [
  60 * 1000, // 1 min after attempt 1
  5 * 60 * 1000, // 5 min after attempt 2
  15 * 60 * 1000, // 15 min after attempt 3
  30 * 60 * 1000, // 30 min after attempt 4
];
const LEASE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** True when a local process with this pid still runs. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

@Injectable()
export class SpeakingWorkerService implements OnModuleInit {
  private readonly logger = new Logger(SpeakingWorkerService.name);
  private isProcessing = false;
  /** Stamped on every claim so a restart can tell its own work from orphans. */
  private readonly workerId = `legacy-${process.pid}-${randomUUID()}`;

  onModuleInit(): void {
    const mode = getSpeakingPipelineMode();
    this.logger.log(`Speaking pipeline mode: ${mode}`);
    this.logger.log(
      mode === 'bullmq'
        ? 'Legacy speaking DB poller: disabled; standalone speaking worker expected'
        : 'Legacy speaking DB poller: enabled; standalone speaking worker must remain stopped',
    );
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly uploadService: UploadService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly queueService?: SpeakingQueueService,
    @Optional()
    private readonly eventPublisher?: SpeakingEventPublisherService,
    @Optional()
    private readonly postProcessing?: SpeakingPostProcessingService,
    @Optional() private readonly learnerProgress?: LearnerProgressService,
  ) {}

  /**
   * Scheduled loop running every 3 seconds to claim and process pending submissions,
   * and to recover any orphaned or stuck leases.
   * Inactive when SPEAKING_PIPELINE_MODE=bullmq (independent worker runs instead).
   */
  @Interval(3000)
  async pollAndProcess(): Promise<void> {
    const pipelineMode = getSpeakingPipelineMode();
    if (pipelineMode === 'bullmq') {
      return; // Do not run legacy DB polling loop when BullMQ mode is active
    }

    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.recoverStuckLeases();
      await this.processNextBatch();
      await this.sweepPostProcessing();
    } catch (err: any) {
      this.logger.error(
        `Error in SpeakingWorker polling loop: ${err.message}`,
        err.stack,
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Legacy-mode consumer for feedback and reward. Claims are atomic in
   * SpeakingPostProcessingService (status + lease + worker token), and the
   * reward is idempotent per submission, so a restart or an overlapping tick
   * cannot grant twice. A failure leaves the row PENDING for the next tick;
   * after POST_PROCESSING_RETRY_WINDOW_MS the attempt is terminal (FAILED).
   */
  private async sweepPostProcessing(): Promise<void> {
    if (!this.postProcessing) return;
    const lease = new Date(
      Date.now() - getLeaseTimeoutMs(getSpeakingWorkerConfig().jobTimeoutMs),
    );
    // A row that failed less than RETRY_BACKOFF_MS ago waits, so a failing
    // provider is not called on every 3 s tick.
    const backoff = new Date(Date.now() - POST_PROCESSING_RETRY_BACKOFF_MS);
    const due = (field: 'rewardStatus' | 'feedbackStatus') => {
      const startedAt =
        field === 'rewardStatus' ? 'rewardStartedAt' : 'feedbackStartedAt';
      return this.prisma.speakingSubmission.findMany({
        where: {
          status: 'COMPLETED',
          OR: [
            { [field]: 'PENDING', [startedAt]: null },
            { [field]: 'PENDING', [startedAt]: { lte: backoff } },
            { [field]: 'PROCESSING', [startedAt]: { lte: lease } },
          ],
        },
        select: { id: true, processedAt: true },
        orderBy: { id: 'asc' },
        take: 5,
      });
    };
    const attemptFor = (processedAt: Date | null) =>
      processedAt &&
      Date.now() - processedAt.getTime() > POST_PROCESSING_RETRY_WINDOW_MS
        ? POST_PROCESSING_MAX_ATTEMPTS
        : 1;
    // Rewards first: they are fast and do not depend on an AI provider.
    for (const row of await due('rewardStatus')) {
      try {
        await this.postProcessing.processReward(
          row.id,
          `legacy-reward-${row.id}`,
          attemptFor(row.processedAt),
          POST_PROCESSING_MAX_ATTEMPTS,
        );
      } catch (err: any) {
        this.logger.warn(
          `Reward for #${row.id} will be retried: ${err.message}`,
        );
      }
    }
    for (const row of await due('feedbackStatus')) {
      try {
        await this.postProcessing.processFeedback(
          row.id,
          `legacy-feedback-${row.id}`,
          attemptFor(row.processedAt),
          POST_PROCESSING_MAX_ATTEMPTS,
        );
      } catch (err: any) {
        this.logger.warn(
          `Feedback for #${row.id} will be retried: ${err.message}`,
        );
      }
    }
  }

  /**
   * Triggered immediately when a submission is created to process without delay in legacy mode.
   */
  triggerProcessing(): void {
    const pipelineMode = getSpeakingPipelineMode();
    if (pipelineMode === 'bullmq') {
      return; // In BullMQ mode, enqueuing handles dispatching
    }

    setImmediate(() => {
      this.pollAndProcess().catch((err) => {
        this.logger.error(
          `Immediate processing trigger failed: ${err.message}`,
        );
      });
    });
  }

  /**
   * Recovers submissions stuck in PROCESSING state beyond the LEASE_TIMEOUT_MS.
   */
  async recoverStuckLeases(): Promise<void> {
    await this.recoverOrphanedClaims();
    const cutoff = new Date(Date.now() - LEASE_TIMEOUT_MS);

    // 1. Mark as FAILED if max attempts already reached
    await this.prisma.speakingSubmission.updateMany({
      where: {
        status: 'PROCESSING',
        processingStartedAt: { lte: cutoff },
        attemptCount: { gte: MAX_ATTEMPTS },
      },
      data: {
        status: 'FAILED',
        lastErrorCode: 'LEASE_TIMEOUT_EXCEEDED',
        lastErrorMessage:
          'Processing lease expired and maximum retry attempts reached',
        processedAt: new Date(),
      },
    });

    // 2. Re-queue eligible submissions back to PENDING for retry
    await this.prisma.speakingSubmission.updateMany({
      where: {
        status: 'PROCESSING',
        processingStartedAt: { lte: cutoff },
        attemptCount: { lt: MAX_ATTEMPTS },
      },
      data: {
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });
  }

  /**
   * Claims and processes available pending submissions.
   */
  private async processNextBatch(): Promise<void> {
    // Process up to 5 submissions per batch
    for (let i = 0; i < 5; i++) {
      const claimedId = await this.claimNextPendingSubmission();
      if (!claimedId) {
        break; // No more pending work
      }
      await this.processSubmission(claimedId);
    }
  }

  /**
   * A submission claimed by a legacy poller whose process has exited (backend
   * restart, watch reload, crash) goes back to PENDING at once instead of
   * waiting out the 5-minute lease while the learner watches a spinner. Only
   * pids on this machine are checked; claims without a stamp keep the lease.
   */
  private async recoverOrphanedClaims(): Promise<void> {
    const claimed = await this.prisma.speakingSubmission.findMany({
      where: {
        status: 'PROCESSING',
        workerId: { startsWith: 'legacy-', not: this.workerId },
      },
      select: { id: true, workerId: true },
    });
    const orphans = claimed
      .filter((row) => {
        const pid = Number(row.workerId?.split('-')[1]);
        return (
          Number.isInteger(pid) && pid !== process.pid && !processAlive(pid)
        );
      })
      .map((row) => row.id);
    if (!orphans.length) return;
    const reset = await this.prisma.speakingSubmission.updateMany({
      where: { id: { in: orphans }, status: 'PROCESSING' },
      data: { status: 'PENDING', nextAttemptAt: new Date(), workerId: null },
    });
    this.logger.warn(
      `Requeued ${reset.count} speaking submission(s) left PROCESSING by an exited poller: ${orphans.join(', ')}`,
    );
  }

  /**
   * Atomically claims the next PENDING submission using PostgreSQL SKIP LOCKED.
   * Multi-instance safe and deadlock free.
   */
  async claimNextPendingSubmission(): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: number }>>`
        UPDATE "SpeakingSubmission"
        SET "status" = 'PROCESSING'::"SpeakingSubmissionStatus",
            "processingStartedAt" = NOW(),
            "workerId" = ${this.workerId},
            "attemptCount" = "attemptCount" + 1
        WHERE id = (
          SELECT id
          FROM "SpeakingSubmission"
          WHERE "status" = 'PENDING'::"SpeakingSubmissionStatus"
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
          ORDER BY "submittedAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id;
      `;

      return rows.length > 0 ? rows[0].id : null;
    } catch (err: any) {
      this.logger.error(`Failed to claim pending submission: ${err.message}`);
      return null;
    }
  }

  /**
   * Evaluates a single claimed submission with durable retry and error isolation.
   */
  async processSubmission(submissionId: number): Promise<void> {
    const submission = await this.prisma.speakingSubmission.findUnique({
      where: { id: submissionId },
      include: {
        exercise: { include: { practiceSet: { select: { scope: true } } } },
      },
    });

    if (!submission) {
      this.logger.warn(
        `Submission #${submissionId} not found during processing`,
      );
      return;
    }

    if (submission.status === 'COMPLETED') {
      this.logger.log(
        `[SpeakingWorker] Submission #${submissionId} is already COMPLETED. Skipping.`,
      );
      return;
    }

    this.logger.log(
      `Processing SpeakingSubmission #${submissionId} (Attempt ${submission.attemptCount}/${MAX_ATTEMPTS})`,
    );

    let audioBuffer: Buffer;

    // 1. Download audio from storage using audioKey
    try {
      if (!submission.audioKey) {
        throw new Error('MISSING_AUDIO_KEY: Submission has no audioKey stored');
      }
      audioBuffer = await this.uploadService.downloadRecordingBuffer(
        submission.audioKey,
      );
    } catch (storageErr: any) {
      this.logger.error(
        `Failed to download audio for submission #${submissionId}: ${storageErr.message}`,
      );
      if (isMissingStorageError(storageErr)) {
        await this.prisma.speakingSubmission.updateMany({
          where: {
            id: submissionId,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: {
            status: 'FAILED',
            overallScore: null,
            lastErrorCode: 'AUDIO_OBJECT_NOT_FOUND',
            lastErrorMessage: 'Audio object is not available in storage',
            processedAt: new Date(),
            nextAttemptAt: null,
          },
        });
        this.eventEmitter.emit(SPEAKING_FAILED_EVENT, {
          submissionId,
          userId: submission.userId,
          exerciseId: submission.exerciseId,
        });
        return;
      }
      await this.handleTransientFailure(
        submissionId,
        submission.attemptCount,
        'STORAGE_UNAVAILABLE',
        `Storage download failed: ${storageErr.message}`,
      );
      return;
    }

    // 2. Validate audio bytes again
    try {
      const validation = validateSpeakingAudio(
        audioBuffer,
        submission.audioMimeType || undefined,
        maxRecordingMs(
          speakingTaskTiming({
            taskType: submission.exercise.taskType,
            order: submission.exercise.order,
            examTask:
              submission.exercise.practiceSet?.scope === 'EXAM_INTERNAL',
          }),
        ),
      );
      if (validation.quality.isSilent) {
        await this.prisma.speakingSubmission.update({
          where: { id: submissionId },
          data: {
            status: 'COMPLETED',
            overallScore: null,
            transcript: '',
            aiFeedback: {
              isSilentOrNoSpeech: true,
              errorCode: 'NO_SPEECH',
            },
            processedAt: new Date(),
            lastErrorCode: 'NO_SPEECH',
            lastErrorMessage: null,
            nextAttemptAt: null,
          },
        });
        const traceId = `legacy-silent-${submissionId}-${Date.now()}`;
        if (this.eventPublisher) {
          await this.eventPublisher.publishEvent({
            type: SPEAKING_COMPLETED_EVENT,
            userId: submission.userId,
            submissionId,
            traceId,
          });
        }
        return;
      }
    } catch (valErr: any) {
      this.logger.warn(
        `Audio bytes validation failed for submission #${submissionId}: ${valErr.message}`,
      );
      // Permanent failure — do not retry corrupt audio
      await this.prisma.speakingSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'FAILED',
          overallScore: null,
          lastErrorCode: 'INVALID_AUDIO',
          lastErrorMessage: valErr.message,
          processedAt: new Date(),
          nextAttemptAt: null,
        },
      });
      return;
    }

    // 3. Call Azure Speech via AiService. Same rule as the BullMQ processor:
    // the mock evaluator only when explicitly enabled, never in production.
    let assessmentResult: any;
    try {
      assessmentResult = legacyMockEnabled()
        ? await mockPracticeSpeech(submission.exercise, audioBuffer)
        : await assessPracticeSpeech(
            this.aiService,
            submission.exercise,
            audioBuffer,
          );
    } catch (providerErr: any) {
      const code = providerErr?.code || 'PROVIDER_UNAVAILABLE';
      this.logger.error(
        `Pronunciation assessment provider error for submission #${submissionId}: [${code}] ${providerErr.message}`,
      );
      await this.handleTransientFailure(
        submissionId,
        submission.attemptCount,
        code,
        providerErr.message,
      );
      return;
    }

    // 4. Determine score semantics
    const isSilent = Boolean(
      assessmentResult.isSilentOrNoSpeech ||
      assessmentResult.errorCode === 'NO_SPEECH',
    );
    // A valid recording with no detected speech is a completed attempt, but it
    // has no pronunciation score. Keep the distinction from a real low score
    // and from provider failures; never manufacture a numeric zero.
    const overallScore = isSilent
      ? null
      : Number(assessmentResult.overallScore);
    const transcript = assessmentResult.transcript || '';
    const lastErrorCode = isSilent ? 'NO_SPEECH' : null;

    // 5. Save results and mark COMPLETED
    const updated = await this.prisma.speakingSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'COMPLETED',
        overallScore,
        transcript,
        aiFeedback: assessmentResult,
        provider: legacyMockEnabled() ? 'mock' : 'azure',
        scoreVersion: 'v1',
        processedAt: new Date(),
        lastErrorCode,
        lastErrorMessage: null,
        nextAttemptAt: null,
      },
    });

    this.logger.log(
      `Successfully completed SpeakingSubmission #${submissionId} with score ${overallScore ?? 'NO_SPEECH'}`,
    );

    const traceId = `legacy-${submissionId}-${Date.now()}`;
    if (this.eventPublisher) {
      await this.eventPublisher.publishEvent({
        type: SPEAKING_COMPLETED_EVENT,
        userId: submission.userId,
        submissionId,
        traceId,
      });
    }

    // Every scored attempt counts toward level progress; never fails the job.
    await this.learnerProgress?.recordSpeakingAttempt({
      userId: submission.userId,
      exerciseId: submission.exerciseId,
      submissionId,
      overallScore,
    });

    // 6. Durable post-processing starts only after score persistence. Keep the
    // old event path for isolated legacy tests/consumers without a queue.
    if (this.queueService) {
      await this.prisma.speakingSubmission.updateMany({
        where: { id: submissionId, status: 'COMPLETED' },
        data: {
          feedbackStatus: 'PENDING',
          rewardStatus:
            !isSilent && overallScore !== null && overallScore > 0
              ? 'PENDING'
              : 'NOT_REQUESTED',
        },
      });
      // This poller runs only in legacy mode, where the standalone worker
      // that consumes BullMQ jobs refuses to start: enqueued jobs would never
      // run (no feedback, no XP). The PENDING rows are picked up by
      // sweepPostProcessing on the next tick instead.
      if (!this.postProcessing) {
        try {
          await this.queueService.enqueueFeedback(submissionId, traceId);
          if (!isSilent && overallScore !== null && overallScore > 0)
            await this.queueService.enqueueReward(submissionId, traceId);
        } catch (queueErr: any) {
          this.logger.error(
            `Failed to enqueue speaking post-processing #${submissionId}: ${queueErr.message}`,
          );
        }
      }
      return;
    }

    // 7. Legacy gamification reward idempotency check
    if (
      !updated.rewardGrantedAt &&
      !isSilent &&
      overallScore !== null &&
      overallScore > 0
    ) {
      const rewardClaim = await this.prisma.speakingSubmission.updateMany({
        where: {
          id: submissionId,
          status: 'COMPLETED',
          rewardGrantedAt: null,
        },
        data: { rewardGrantedAt: new Date() },
      });

      if (rewardClaim.count !== 1) {
        return;
      }

      try {
        await this.eventEmitter.emitAsync('speaking.submitted', {
          submissionId: updated.id,
          userId: updated.userId,
          exerciseId: updated.exerciseId,
          overallScore,
          isSilentOrNoSpeech: false,
        });
      } catch (eventErr: any) {
        this.logger.error(
          `Failed to emit gamification event for submission #${submissionId}: ${eventErr.message}`,
        );
      }
    }
  }

  /**
   * Handles transient provider/network failures with exponential backoff.
   */
  private async handleTransientFailure(
    submissionId: number,
    attemptCount: number,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    if (attemptCount >= MAX_ATTEMPTS) {
      this.logger.warn(
        `Submission #${submissionId} reached max retry attempts (${MAX_ATTEMPTS}). Marking as FAILED.`,
      );
      await this.prisma.speakingSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'FAILED',
          overallScore: null,
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage,
          processedAt: new Date(),
          nextAttemptAt: null,
        },
      });
      return;
    }

    const backoffMs = RETRY_BACKOFF_MS[attemptCount - 1] || 30 * 60 * 1000;
    const nextAttemptAt = new Date(Date.now() + backoffMs);

    this.logger.log(
      `Scheduling retry for submission #${submissionId} at ${nextAttemptAt.toISOString()} (Backoff: ${backoffMs / 1000}s)`,
    );

    await this.prisma.speakingSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'PENDING',
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        nextAttemptAt,
      },
    });
  }
}
