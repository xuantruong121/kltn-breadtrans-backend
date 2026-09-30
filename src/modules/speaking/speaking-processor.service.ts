import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { validateSpeakingAudio } from './speaking-audio-validator';
import { MockSpeakingEvaluator } from './mock-speaking-evaluator';
import * as crypto from 'crypto';
import {
  SPEAKING_EVENTS_CHANNEL,
  SPEAKING_COMPLETED_EVENT,
  SPEAKING_FAILED_EVENT,
  SpeakingJobPayload,
  SpeakingEventPayload,
  getSpeakingWorkerConfig,
  getLeaseTimeoutMs,
} from './speaking.constants';

const MAX_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = [
  5 * 1000, // 5s after attempt 1
  15 * 1000, // 15s after attempt 2
  60 * 1000, // 60s after attempt 3
  5 * 60 * 1000, // 5m after attempt 4
];

@Injectable()
export class SpeakingProcessorService {
  private readonly logger = new Logger(SpeakingProcessorService.name);
  private pubRedis: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly uploadService: UploadService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.pubRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  /**
   * Top-level entry point for processing a Speaking Assessment job.
   * Wraps processing within an explicit timeout boundary (jobTimeoutMs).
   */
  async processJob(jobPayload: SpeakingJobPayload): Promise<void> {
    const { jobTimeoutMs } = getSpeakingWorkerConfig();
    const abortController = new AbortController();
    const workerToken = `worker-${crypto.randomUUID()}`;
    let isTimedOut = false;

    const timeoutTimer = setTimeout(() => {
      isTimedOut = true;
      abortController.abort(
        new Error(
          `JOB_TIMEOUT: Speaking assessment processing exceeded configured limit of ${jobTimeoutMs}ms`,
        ),
      );
    }, jobTimeoutMs);

    try {
      await Promise.race([
        this.executeJob(jobPayload, abortController.signal, workerToken),
        new Promise<never>((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            const reason = abortController.signal.reason;
            reject(
              reason instanceof Error ? reason : new Error(String(reason)),
            );
          });
        }),
      ]);
    } catch (err: unknown) {
      const isJobTimeout =
        isTimedOut ||
        (err instanceof Error && err.message.includes('JOB_TIMEOUT'));

      if (isJobTimeout) {
        this.logger.error(
          `[SpeakingProcessor] Job #${jobPayload.submissionId} timed out after ${jobTimeoutMs}ms (traceId=${jobPayload.traceId})`,
        );

        const sub = await this.prisma.speakingSubmission.findUnique({
          where: { id: jobPayload.submissionId },
          select: { userId: true, attemptCount: true },
        });

        if (sub) {
          await this.handleTransientFailure(
            sub.userId,
            jobPayload.submissionId,
            jobPayload.traceId,
            sub.attemptCount,
            'JOB_TIMEOUT',
            `Processing exceeded timeout limit of ${jobTimeoutMs}ms`,
            workerToken,
          );
        }
      }
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  /**
   * Internal execution pipeline with atomic claim semantics, byte validation,
   * AI evaluation, and idempotent reward grants.
   */
  private async executeJob(
    jobPayload: SpeakingJobPayload,
    signal: AbortSignal,
    workerToken: string,
  ): Promise<void> {
    const { submissionId, traceId } = jobPayload;
    const tJobStart = Date.now();

    // 1. Load submission to verify existence and check idempotency
    const existing = await this.prisma.speakingSubmission.findUnique({
      where: { id: submissionId },
      include: { exercise: true },
    });

    if (!existing) {
      this.logger.warn(
        `[SpeakingProcessor] Submission #${submissionId} not found (traceId=${traceId})`,
      );
      return;
    }

    // Idempotency: If already COMPLETED, do not re-score or overwrite
    if (existing.status === 'COMPLETED') {
      this.logger.log(
        `[SpeakingProcessor] Submission #${submissionId} is already COMPLETED. Skipping duplicate job. (traceId=${traceId})`,
      );
      return;
    }

    // 2. Atomically claim submission: PENDING -> PROCESSING (or reclaim expired PROCESSING lease)
    const { jobTimeoutMs } = getSpeakingWorkerConfig();
    const leaseTimeoutMs = getLeaseTimeoutMs(jobTimeoutMs);
    const leaseCutoff = new Date(Date.now() - leaseTimeoutMs);

    const claimResult = await this.prisma.speakingSubmission.updateMany({
      where: {
        id: submissionId,
        OR: [
          { status: 'PENDING' },
          {
            status: 'PROCESSING',
            processingStartedAt: { lte: leaseCutoff },
          },
        ],
      },
      data: {
        status: 'PROCESSING',
        processingStartedAt: new Date(),
        workerId: workerToken,
        attemptCount: { increment: 1 },
      },
    });

    if (claimResult.count === 0) {
      this.logger.warn(
        `[SpeakingProcessor] Exclusive atomic claim failed for submission #${submissionId}. Status is not claimable (already actively PROCESSING or terminal). Aborting duplicate execution. (traceId=${traceId})`,
      );
      return;
    }

    const currentAttempt = existing.attemptCount + 1;
    const queueWaitMs = tJobStart - new Date(existing.submittedAt).getTime();

    this.logger.log(
      `[SpeakingProcessor] Exclusive claim acquired for submission #${submissionId} (attempt ${currentAttempt}/${MAX_ATTEMPTS}, traceId=${traceId}, queueWait=${queueWaitMs}ms)`,
    );

    if (signal.aborted) throw signal.reason;

    let audioBuffer: Buffer;
    let tDownloadMs = 0;
    let tValidationMs = 0;
    let tScoringMs = 0;

    // 3. Download audio from storage using audioKey (or synthetic audio in mock mode)
    const tDownloadStart = Date.now();
    try {
      if (!existing.audioKey || existing.audioKey.startsWith('mock-')) {
        if (MockSpeakingEvaluator.isMockEnabled()) {
          const sampleCount = 16000;
          audioBuffer = Buffer.alloc(44 + sampleCount * 2);
          audioBuffer.write('RIFF', 0);
          audioBuffer.writeUInt32LE(36 + sampleCount * 2, 4);
          audioBuffer.write('WAVEfmt ', 8);
          audioBuffer.writeUInt32LE(16, 16);
          audioBuffer.writeUInt16LE(1, 20);
          audioBuffer.writeUInt16LE(1, 22);
          audioBuffer.writeUInt32LE(16000, 24);
          audioBuffer.writeUInt32LE(32000, 28);
          audioBuffer.writeUInt16LE(2, 32);
          audioBuffer.writeUInt16LE(16, 34);
          audioBuffer.write('data', 36);
          audioBuffer.writeUInt32LE(sampleCount * 2, 40);
          for (let i = 44; i < audioBuffer.length; i += 2) {
            audioBuffer.writeInt16LE(Math.round(Math.sin(i / 10) * 10000), i);
          }
        } else {
          throw new Error(
            'MISSING_AUDIO_KEY: Submission has no audioKey stored',
          );
        }
      } else {
        try {
          audioBuffer = await this.uploadService.downloadFileBuffer(
            existing.audioKey,
          );
        } catch (downloadErr: any) {
          if (MockSpeakingEvaluator.isMockEnabled()) {
            this.logger.warn(
              `Storage download failed in mock mode, falling back to synthetic audio: ${downloadErr.message}`,
            );
            const sampleCount = 16000;
            audioBuffer = Buffer.alloc(44 + sampleCount * 2);
            audioBuffer.write('RIFF', 0);
            audioBuffer.writeUInt32LE(36 + sampleCount * 2, 4);
            audioBuffer.write('WAVEfmt ', 8);
            audioBuffer.writeUInt32LE(16, 16);
            audioBuffer.writeUInt16LE(1, 20);
            audioBuffer.writeUInt16LE(1, 22);
            audioBuffer.writeUInt32LE(16000, 24);
            audioBuffer.writeUInt32LE(32000, 28);
            audioBuffer.writeUInt16LE(2, 32);
            audioBuffer.writeUInt16LE(16, 34);
            audioBuffer.write('data', 36);
            audioBuffer.writeUInt32LE(sampleCount * 2, 40);
            for (let i = 44; i < audioBuffer.length; i += 2) {
              audioBuffer.writeInt16LE(Math.round(Math.sin(i / 10) * 10000), i);
            }
          } else {
            throw downloadErr;
          }
        }
      }
      tDownloadMs = Date.now() - tDownloadStart;
    } catch (storageErr: any) {
      tDownloadMs = Date.now() - tDownloadStart;
      this.logger.error(
        `[SpeakingProcessor] Failed to download audio for submission #${submissionId}: ${storageErr.message} (traceId=${traceId})`,
      );
      await this.handleTransientFailure(
        existing.userId,
        submissionId,
        traceId,
        currentAttempt,
        'STORAGE_UNAVAILABLE',
        `Storage download failed: ${storageErr.message}`,
        workerToken,
      );
      throw storageErr; // Rethrow to let BullMQ manage backoff retry
    }

    if (signal.aborted) throw signal.reason;

    // 4. Validate audio bytes
    const tValidationStart = Date.now();
    try {
      const validation = validateSpeakingAudio(
        audioBuffer,
        existing.audioMimeType || undefined,
      );
      tValidationMs = Date.now() - tValidationStart;

      if (validation.quality.isSilent) {
        if (signal.aborted) throw signal.reason;

        const silentUpdate = await this.prisma.speakingSubmission.updateMany({
          where: {
            id: submissionId,
            status: 'PROCESSING',
            workerId: workerToken,
          },
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

        if (silentUpdate.count === 0) {
          this.logger.warn(
            `[SpeakingProcessor] Lease lost for silent submission #${submissionId} (workerToken=${workerToken}). Discarding stale write.`,
          );
          return;
        }

        await this.publishEvent({
          type: SPEAKING_COMPLETED_EVENT,
          userId: existing.userId,
          submissionId,
          traceId,
        });

        this.logStructuredLatency({
          traceId,
          submissionId,
          status: 'COMPLETED_SILENT',
          queueWaitMs,
          r2DownloadMs: tDownloadMs,
          validationMs: tValidationMs,
          azureScoringMs: 0,
          dbPersistMs: Date.now() - tValidationStart,
          totalWorkerMs: Date.now() - tJobStart,
        });
        return;
      }
    } catch (valErr: any) {
      tValidationMs = Date.now() - tValidationStart;
      this.logger.warn(
        `[SpeakingProcessor] Permanent audio validation failure for submission #${submissionId}: ${valErr.message} (traceId=${traceId})`,
      );

      // Permanent failure — mark DB FAILED, emit event, and throw UnrecoverableError
      const failUpdate = await this.prisma.speakingSubmission.updateMany({
        where: {
          id: submissionId,
          status: 'PROCESSING',
          workerId: workerToken,
        },
        data: {
          status: 'FAILED',
          overallScore: null,
          lastErrorCode: 'INVALID_AUDIO',
          lastErrorMessage: valErr.message,
          processedAt: new Date(),
          nextAttemptAt: null,
        },
      });

      if (failUpdate.count === 0) {
        this.logger.warn(
          `[SpeakingProcessor] Lease lost for invalid submission #${submissionId} (workerToken=${workerToken}). Discarding stale write.`,
        );
        throw new UnrecoverableError(`INVALID_AUDIO: ${valErr.message}`);
      }

      await this.publishEvent({
        type: SPEAKING_FAILED_EVENT,
        userId: existing.userId,
        submissionId,
        traceId,
      });

      this.logStructuredLatency({
        traceId,
        submissionId,
        status: 'FAILED_INVALID_AUDIO',
        queueWaitMs,
        r2DownloadMs: tDownloadMs,
        validationMs: tValidationMs,
        azureScoringMs: 0,
        dbPersistMs: Date.now() - tValidationStart,
        totalWorkerMs: Date.now() - tJobStart,
      });

      // BullMQ UnrecoverableError stops further retries permanently
      throw new UnrecoverableError(`INVALID_AUDIO: ${valErr.message}`);
    }

    if (signal.aborted) throw signal.reason;

    // 5. Evaluate pronunciation (Mock or Azure)
    const tScoringStart = Date.now();
    let assessmentResult: any;
    try {
      if (MockSpeakingEvaluator.isMockEnabled()) {
        assessmentResult = await MockSpeakingEvaluator.evaluate(
          existing.exercise.targetText,
          audioBuffer,
          { signal },
        );
      } else {
        assessmentResult = await this.aiService.assessPronunciation(
          existing.exercise.targetText,
          audioBuffer,
          { signal },
        );
      }
      tScoringMs = Date.now() - tScoringStart;
    } catch (providerErr: any) {
      tScoringMs = Date.now() - tScoringStart;
      const code = providerErr?.code || 'PROVIDER_UNAVAILABLE';
      this.logger.error(
        `[SpeakingProcessor] Pronunciation assessment provider error for submission #${submissionId}: [${code}] ${providerErr.message} (traceId=${traceId})`,
      );

      await this.handleTransientFailure(
        existing.userId,
        submissionId,
        traceId,
        currentAttempt,
        code,
        providerErr.message,
        workerToken,
      );
      throw providerErr; // Rethrow to trigger BullMQ backoff retry
    }

    // Guard against writing results if job timed out during evaluation
    if (signal.aborted) {
      this.logger.warn(
        `[SpeakingProcessor] Evaluator completed after timeout for submission #${submissionId}. Discarding stale result. (traceId=${traceId})`,
      );
      throw signal.reason;
    }

    // 6. Score semantics
    const isSilent = Boolean(
      assessmentResult.isSilentOrNoSpeech ||
      assessmentResult.errorCode === 'NO_SPEECH',
    );
    const overallScore = isSilent
      ? null
      : Number(assessmentResult.overallScore);
    const transcript = assessmentResult.transcript || '';
    const lastErrorCode = isSilent ? 'NO_SPEECH' : null;

    // 7. Persist result and commit COMPLETED status (Token-Fenced)
    const tPersistStart = Date.now();
    const persistResult = await this.prisma.speakingSubmission.updateMany({
      where: {
        id: submissionId,
        status: 'PROCESSING',
        workerId: workerToken,
      },
      data: {
        status: 'COMPLETED',
        overallScore,
        transcript,
        aiFeedback: assessmentResult,
        provider: MockSpeakingEvaluator.isMockEnabled() ? 'mock' : 'azure',
        scoreVersion: 'v1',
        processedAt: new Date(),
        lastErrorCode,
        lastErrorMessage: null,
        nextAttemptAt: null,
      },
    });

    if (persistResult.count === 0) {
      this.logger.warn(
        `[SpeakingProcessor] Lease lost for submission #${submissionId} (workerToken=${workerToken}). Fencing token mismatch or reclaimed by another worker. Discarding stale scoring result. (traceId=${traceId})`,
      );
      return;
    }

    const tPersistMs = Date.now() - tPersistStart;
    const tTotalWorkerMs = Date.now() - tJobStart;

    this.logger.log(
      `[SpeakingProcessor] Successfully completed SpeakingSubmission #${submissionId} with score ${overallScore ?? 'NO_SPEECH'} (traceId=${traceId}, total=${tTotalWorkerMs}ms)`,
    );

    // 8. Gamification reward idempotency check (Token-Fenced)
    if (!isSilent && overallScore !== null && overallScore > 0) {
      const rewardClaim = await this.prisma.speakingSubmission.updateMany({
        where: {
          id: submissionId,
          status: 'COMPLETED',
          workerId: workerToken,
          rewardGrantedAt: null,
        },
        data: { rewardGrantedAt: new Date() },
      });

      if (rewardClaim.count === 1) {
        try {
          await this.eventEmitter.emitAsync('speaking.submitted', {
            submissionId: existing.id,
            userId: existing.userId,
            exerciseId: existing.exerciseId,
            overallScore,
            isSilentOrNoSpeech: false,
          });
        } catch (eventErr: any) {
          this.logger.error(
            `[SpeakingProcessor] Failed to emit gamification event for submission #${submissionId}: ${eventErr.message}`,
          );
        }
      }
    }

    // 9. ONLY after DB commit succeeds, publish completion notification to Redis Pub/Sub
    // Security: Pub/Sub payload contains ONLY metadata. No raw overallScore or assessment data.
    await this.publishEvent({
      type: SPEAKING_COMPLETED_EVENT,
      userId: existing.userId,
      submissionId,
      traceId,
    });

    // 10. Record structured latency log
    this.logStructuredLatency({
      traceId,
      submissionId,
      status: 'COMPLETED',
      queueWaitMs,
      r2DownloadMs: tDownloadMs,
      validationMs: tValidationMs,
      azureScoringMs: tScoringMs,
      dbPersistMs: tPersistMs,
      totalWorkerMs: tTotalWorkerMs,
    });
  }

  /**
   * Handles transient errors with exponential backoff and terminal failure transition.
   * Fenced by workerToken so stale workers cannot overwrite active or recovered jobs.
   */
  private async handleTransientFailure(
    userId: number,
    submissionId: number,
    traceId: string,
    attemptCount: number,
    errorCode: string,
    errorMessage: string,
    workerToken?: string,
  ): Promise<void> {
    if (attemptCount >= MAX_ATTEMPTS) {
      this.logger.warn(
        `[SpeakingProcessor] Submission #${submissionId} reached max retry attempts (${MAX_ATTEMPTS}). Marking as FAILED. (traceId=${traceId})`,
      );

      const failResult = await this.prisma.speakingSubmission.updateMany({
        where: {
          id: submissionId,
          status: 'PROCESSING',
          ...(workerToken ? { workerId: workerToken } : {}),
        },
        data: {
          status: 'FAILED',
          overallScore: null,
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage,
          processedAt: new Date(),
          nextAttemptAt: null,
        },
      });

      if (failResult.count === 1) {
        await this.publishEvent({
          type: SPEAKING_FAILED_EVENT,
          userId,
          submissionId,
          traceId,
        });
      }
      return;
    }

    const backoffMs = RETRY_BACKOFF_MS[attemptCount - 1] || 60 * 1000;
    const nextAttemptAt = new Date(Date.now() + backoffMs);

    this.logger.log(
      `[SpeakingProcessor] Scheduling delayed retry for submission #${submissionId} at ${nextAttemptAt.toISOString()} (Backoff: ${backoffMs / 1000}s, traceId=${traceId})`,
    );

    await this.prisma.speakingSubmission.updateMany({
      where: {
        id: submissionId,
        status: 'PROCESSING',
        ...(workerToken ? { workerId: workerToken } : {}),
      },
      data: {
        status: 'PENDING',
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        nextAttemptAt,
      },
    });
  }

  /**
   * Publishes lightweight event to Redis Pub/Sub for API Socket.IO gateway forwarding.
   * Strictly emits only type, userId, submissionId, and traceId.
   */
  private async publishEvent(payload: SpeakingEventPayload): Promise<void> {
    try {
      const message = JSON.stringify(payload);
      await this.pubRedis.publish(SPEAKING_EVENTS_CHANNEL, message);
      this.logger.log(
        `[SpeakingProcessor] Published ${payload.type} event to Redis channel "${SPEAKING_EVENTS_CHANNEL}" (submissionId=${payload.submissionId}, userId=${payload.userId}, traceId=${payload.traceId})`,
      );
    } catch (err: any) {
      this.logger.error(
        `[SpeakingProcessor] Failed to publish event to Redis: ${err.message}`,
      );
    }
  }

  /**
   * Structured numeric latency logging.
   */
  private logStructuredLatency(metrics: {
    traceId: string;
    submissionId: number;
    status: string;
    queueWaitMs: number;
    r2DownloadMs: number;
    validationMs: number;
    azureScoringMs: number;
    dbPersistMs: number;
    totalWorkerMs: number;
  }): void {
    this.logger.log(
      `[LATENCY_INSTRUMENTATION] ` +
        JSON.stringify({
          tag: 'speaking_latency_metrics',
          ...metrics,
          timestamp: new Date().toISOString(),
        }),
    );
  }

  async close(): Promise<void> {
    if (this.pubRedis && this.pubRedis.status !== 'end') {
      try {
        await this.pubRedis.quit();
      } catch {
        // ignore already closed
      }
    }
  }
}
