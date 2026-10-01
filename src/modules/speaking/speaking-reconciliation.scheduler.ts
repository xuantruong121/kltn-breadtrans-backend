import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SpeakingQueueService } from './speaking-queue.service';
import {
  getSpeakingJobId,
  getSpeakingFeedbackJobId,
  getSpeakingRewardJobId,
  getLeaseTimeoutMs,
  getSpeakingWorkerConfig,
  getSpeakingPipelineMode,
  SpeakingJobPayload,
} from './speaking.constants';

const STALE_PENDING_MS = 15 * 1000; // 15 seconds
const MAX_ATTEMPTS = 4;

@Injectable()
export class SpeakingReconciliationScheduler {
  private readonly logger = new Logger(SpeakingReconciliationScheduler.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: SpeakingQueueService,
  ) {}

  /**
   * Periodic reconciliation running every 30 seconds.
   * Discovers and safely recovers orphaned submissions without creating duplicates.
   * Inspects BullMQ job state for each candidate submission:
   * - waiting / active / delayed: skips (lifecycle healthy).
   * - completed: if DB is still non-terminal, removes stale completed job and re-enqueues.
   * - failed: if DB is still PENDING and attempts < 4, removes stale failed job and re-enqueues; otherwise marks DB FAILED.
   * - missing: enqueues.
   * - stale PROCESSING: resets to PENDING and re-enqueues if worker lease expired.
   */
  @Interval(30000)
  async reconcilePendingSubmissions(): Promise<void> {
    const mode = getSpeakingPipelineMode();
    if (mode !== 'bullmq') {
      return; // Do not run reconciliation in legacy mode
    }

    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const now = new Date();
      const pendingCutoff = new Date(now.getTime() - STALE_PENDING_MS);
      const leaseTimeoutMs = getLeaseTimeoutMs(
        getSpeakingWorkerConfig().jobTimeoutMs,
      );
      const processingCutoff = new Date(now.getTime() - leaseTimeoutMs);

      const queue = this.queueService.getQueue();
      if (!queue) {
        this.logger.warn(
          `[SpeakingReconciliation] BullMQ queue instance not ready. Skipping reconciliation cycle.`,
        );
        return;
      }

      // 1. Find eligible PENDING submissions respecting nextAttemptAt
      const pendingSubmissions = await this.prisma.speakingSubmission.findMany({
        where: {
          status: 'PENDING',
          submittedAt: { lte: pendingCutoff },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        take: 20,
        orderBy: { submittedAt: 'asc' },
      });

      // 2. Find orphaned/stuck PROCESSING submissions whose worker lease expired
      const staleProcessingSubmissions =
        await this.prisma.speakingSubmission.findMany({
          where: {
            status: 'PROCESSING',
            processingStartedAt: { lte: processingCutoff },
          },
          take: 10,
          orderBy: { processingStartedAt: 'asc' },
        });

      const candidates = [...pendingSubmissions, ...staleProcessingSubmissions];
      if (candidates.length === 0) {
        await this.reconcilePostProcessingJobs(queue, processingCutoff);
        return;
      }

      this.logger.log(
        `[SpeakingReconciliation] Discovered ${candidates.length} score candidates (${pendingSubmissions.length} PENDING, ${staleProcessingSubmissions.length} stale PROCESSING)`,
      );

      for (const sub of candidates) {
        const jobId = getSpeakingJobId(sub.id);
        const traceId = `reconcile-${crypto.randomUUID()}`;

        try {
          const job = await queue.getJob(jobId);

          // Sub-case 1: Stale PROCESSING submission recovery
          if (sub.status === 'PROCESSING') {
            if (job) {
              const jobState = await job.getState();
              if (jobState === 'active') {
                this.logger.log(
                  `[SpeakingReconciliation] Stale PROCESSING submission #${sub.id} is still marked ACTIVE in BullMQ. Leaving to worker lock mechanism. (jobId=${jobId}, traceId=${traceId})`,
                );
                continue;
              }
              // If completed or failed in BullMQ while DB is stuck in PROCESSING
              await job.remove();
            }

            // Reset DB from PROCESSING back to PENDING and re-enqueue
            await this.prisma.speakingSubmission.update({
              where: { id: sub.id, status: 'PROCESSING' },
              data: {
                status: 'PENDING',
                nextAttemptAt: null,
                lastErrorCode: 'LEASE_EXPIRED_RESET',
              },
            });

            await this.queueService.enqueueSubmission(sub.id, traceId);
            this.logger.log(
              `[SpeakingReconciliation] Recovered stale PROCESSING submission #${sub.id}: reset to PENDING and re-enqueued. (jobId=${jobId}, traceId=${traceId})`,
            );
            continue;
          }

          // Sub-case 2: PENDING submission recovery
          if (!job) {
            // Missing job in Redis (enqueue failed after DB commit, or job evicted)
            await this.queueService.enqueueSubmission(sub.id, traceId);
            this.logger.log(
              `[SpeakingReconciliation] Enqueued missing job for PENDING submission #${sub.id} (jobId=${jobId}, jobState=NOT_FOUND, traceId=${traceId})`,
            );
            continue;
          }

          const jobState = await job.getState();

          if (
            jobState === 'waiting' ||
            jobState === 'active' ||
            jobState === 'delayed'
          ) {
            // Healthy BullMQ state: do NOT duplicate
            this.logger.log(
              `[SpeakingReconciliation] Skipped submission #${sub.id}: BullMQ job is currently ${jobState.toUpperCase()} (jobId=${jobId}, traceId=${traceId})`,
            );
            continue;
          }

          if (jobState === 'completed') {
            // Conflict: BullMQ completed but DB is still PENDING
            this.logger.warn(
              `[SpeakingReconciliation] Conflict detected for submission #${sub.id}: BullMQ job is COMPLETED but DB status is PENDING. Removing stale completed job and re-enqueuing. (jobId=${jobId}, traceId=${traceId})`,
            );
            await job.remove();
            await this.queueService.enqueueSubmission(sub.id, traceId);
            continue;
          }

          if (jobState === 'failed') {
            // Terminal failure in BullMQ
            if (sub.attemptCount < MAX_ATTEMPTS) {
              this.logger.log(
                `[SpeakingReconciliation] BullMQ job failed for submission #${sub.id} but attempts remaining (${sub.attemptCount}/${MAX_ATTEMPTS}). Removing failed job and re-enqueuing. (jobId=${jobId}, traceId=${traceId})`,
              );
              await job.remove();
              await this.queueService.enqueueSubmission(sub.id, traceId);
            } else {
              this.logger.warn(
                `[SpeakingReconciliation] BullMQ job failed and attempts exhausted for submission #${sub.id} (${sub.attemptCount}/${MAX_ATTEMPTS}). Synchronizing DB status to FAILED. (jobId=${jobId}, traceId=${traceId})`,
              );
              await this.prisma.speakingSubmission.update({
                where: { id: sub.id },
                data: {
                  status: 'FAILED',
                  lastErrorCode: 'RETRY_EXHAUSTED',
                  nextAttemptAt: null,
                  processedAt: new Date(),
                },
              });
            }
            continue;
          }
        } catch (subErr: any) {
          this.logger.error(
            `[SpeakingReconciliation] Error reconciling submission #${sub.id}: ${subErr.message}`,
          );
        }
      }

      // Reconcile post-processing feedback and rewards
      await this.reconcilePostProcessingJobs(queue, processingCutoff);
    } catch (err: any) {
      this.logger.error(
        `[SpeakingReconciliation] Error during reconciliation cycle: ${err.message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async reconcilePostProcessingJobs(
    queue: Queue<SpeakingJobPayload, unknown, string>,
    processingCutoff: Date,
  ): Promise<void> {
    // 1. Recover stale PROCESSING feedback
    const staleProcessingFeedback =
      (await this.prisma.speakingSubmission.findMany({
        where: {
          status: 'COMPLETED',
          feedbackStatus: 'PROCESSING',
          feedbackStartedAt: { lte: processingCutoff },
        },
        take: 10,
        orderBy: { feedbackStartedAt: 'asc' },
        select: { id: true },
      })) ?? [];

    for (const sub of staleProcessingFeedback) {
      const jobId = getSpeakingFeedbackJobId(sub.id);
      const traceId = `reconcile-fb-stale-${crypto.randomUUID()}`;
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          const jobState = await job.getState();
          if (jobState === 'active') continue;
          await job.remove();
        }
        await this.prisma.speakingSubmission.update({
          where: { id: sub.id, feedbackStatus: 'PROCESSING' },
          data: { feedbackStatus: 'PENDING', feedbackWorkerId: null },
        });
        await this.queueService.enqueueFeedback(sub.id, traceId);
        this.logger.log(
          `[SpeakingReconciliation] Recovered stale PROCESSING feedback for #${sub.id}`,
        );
      } catch (err: any) {
        this.logger.error(
          `[SpeakingReconciliation] Error recovering feedback #${sub.id}: ${err.message}`,
        );
      }
    }

    // 2. Recover stale PROCESSING rewards
    const staleProcessingRewards =
      (await this.prisma.speakingSubmission.findMany({
        where: {
          status: 'COMPLETED',
          rewardStatus: 'PROCESSING',
          rewardStartedAt: { lte: processingCutoff },
          rewardGrantedAt: null,
        },
        take: 10,
        orderBy: { rewardStartedAt: 'asc' },
        select: { id: true },
      })) ?? [];

    for (const sub of staleProcessingRewards) {
      const jobId = getSpeakingRewardJobId(sub.id);
      const traceId = `reconcile-rw-stale-${crypto.randomUUID()}`;
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          const jobState = await job.getState();
          if (jobState === 'active') continue;
          await job.remove();
        }
        await this.prisma.speakingSubmission.update({
          where: { id: sub.id, rewardStatus: 'PROCESSING' },
          data: { rewardStatus: 'PENDING', rewardWorkerId: null },
        });
        await this.queueService.enqueueReward(sub.id, traceId);
        this.logger.log(
          `[SpeakingReconciliation] Recovered stale PROCESSING reward for #${sub.id}`,
        );
      } catch (err: any) {
        this.logger.error(
          `[SpeakingReconciliation] Error recovering reward #${sub.id}: ${err.message}`,
        );
      }
    }

    // 3. Reconcile PENDING feedback jobs
    const pendingFeedback =
      (await this.prisma.speakingSubmission.findMany({
        where: { status: 'COMPLETED', feedbackStatus: 'PENDING' },
        take: 20,
        orderBy: { processedAt: 'asc' },
        select: { id: true },
      })) ?? [];

    for (const sub of pendingFeedback) {
      const jobId = getSpeakingFeedbackJobId(sub.id);
      const traceId = `reconcile-feedback-${crypto.randomUUID()}`;
      try {
        const job = await queue.getJob(jobId);
        if (!job) {
          await this.queueService.enqueueFeedback(sub.id, traceId);
          continue;
        }
        const state = await job.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') {
          continue;
        }
        if (state === 'completed') {
          await job.remove();
          await this.queueService.enqueueFeedback(sub.id, traceId);
          continue;
        }
        if (state === 'failed') {
          if ((job.attemptsMade ?? 0) < MAX_ATTEMPTS) {
            await job.remove();
            await this.queueService.enqueueFeedback(sub.id, traceId);
          } else {
            await this.prisma.speakingSubmission.update({
              where: { id: sub.id },
              data: {
                feedbackStatus: 'FAILED',
                feedbackProcessedAt: new Date(),
              },
            });
          }
        }
      } catch (err: any) {
        this.logger.error(
          `[SpeakingReconciliation] Error reconciling feedback #${sub.id}: ${err.message}`,
        );
      }
    }

    // 4. Reconcile PENDING reward jobs
    const pendingRewards =
      (await this.prisma.speakingSubmission.findMany({
        where: {
          status: 'COMPLETED',
          rewardStatus: 'PENDING',
          rewardGrantedAt: null,
        },
        take: 20,
        orderBy: { processedAt: 'asc' },
        select: { id: true },
      })) ?? [];

    for (const sub of pendingRewards) {
      const jobId = getSpeakingRewardJobId(sub.id);
      const traceId = `reconcile-reward-${crypto.randomUUID()}`;
      try {
        const job = await queue.getJob(jobId);
        if (!job) {
          await this.queueService.enqueueReward(sub.id, traceId);
          continue;
        }
        const state = await job.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') {
          continue;
        }
        if (state === 'completed') {
          await job.remove();
          await this.queueService.enqueueReward(sub.id, traceId);
          continue;
        }
        if (state === 'failed') {
          if ((job.attemptsMade ?? 0) < MAX_ATTEMPTS) {
            await job.remove();
            await this.queueService.enqueueReward(sub.id, traceId);
          } else {
            await this.prisma.speakingSubmission.update({
              where: { id: sub.id },
              data: {
                rewardStatus: 'FAILED',
                rewardProcessedAt: new Date(),
              },
            });
          }
        }
      } catch (err: any) {
        this.logger.error(
          `[SpeakingReconciliation] Error reconciling reward #${sub.id}: ${err.message}`,
        );
      }
    }
  }
}
