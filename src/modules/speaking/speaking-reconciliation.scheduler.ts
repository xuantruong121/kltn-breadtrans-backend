import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SpeakingQueueService } from './speaking-queue.service';
import { getSpeakingJobId } from './speaking.constants';

const STALE_PENDING_MS = 15 * 1000; // 15 seconds
const STALE_PROCESSING_LEASE_MS = 5 * 60 * 1000; // 5 minutes lease
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
    const mode = process.env.SPEAKING_PIPELINE_MODE || 'legacy';
    if (mode !== 'bullmq') {
      return; // Do not run reconciliation in legacy mode
    }

    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const now = new Date();
      const pendingCutoff = new Date(now.getTime() - STALE_PENDING_MS);
      const processingCutoff = new Date(
        now.getTime() - STALE_PROCESSING_LEASE_MS,
      );

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
      if (candidates.length === 0) return;

      this.logger.log(
        `[SpeakingReconciliation] Discovered ${candidates.length} candidate submissions (${pendingSubmissions.length} PENDING, ${staleProcessingSubmissions.length} stale PROCESSING)`,
      );

      const queue = this.queueService.getQueue();
      if (!queue) {
        this.logger.warn(
          `[SpeakingReconciliation] BullMQ queue instance not ready. Skipping reconciliation cycle.`,
        );
        return;
      }

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
    } catch (err: any) {
      this.logger.error(
        `[SpeakingReconciliation] Error during reconciliation cycle: ${err.message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
