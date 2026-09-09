import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { validateSpeakingAudio } from './speaking-audio-validator';

const MAX_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = [
  60 * 1000, // 1 min after attempt 1
  5 * 60 * 1000, // 5 min after attempt 2
  15 * 60 * 1000, // 15 min after attempt 3
  30 * 60 * 1000, // 30 min after attempt 4
];
const LEASE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class SpeakingWorkerService {
  private readonly logger = new Logger(SpeakingWorkerService.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly uploadService: UploadService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Scheduled loop running every 3 seconds to claim and process pending submissions,
   * and to recover any orphaned or stuck leases.
   */
  @Interval(3000)
  async pollAndProcess(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.recoverStuckLeases();
      await this.processNextBatch();
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
   * Triggered immediately when a submission is created to process without delay.
   */
  triggerProcessing(): void {
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
   * Atomically claims the next PENDING submission using PostgreSQL SKIP LOCKED.
   * Multi-instance safe and deadlock free.
   */
  async claimNextPendingSubmission(): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: number }>>`
        UPDATE "SpeakingSubmission"
        SET "status" = 'PROCESSING'::"SpeakingSubmissionStatus",
            "processingStartedAt" = NOW(),
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
      include: { exercise: true },
    });

    if (!submission) {
      this.logger.warn(
        `Submission #${submissionId} not found during processing`,
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
      audioBuffer = await this.uploadService.downloadFileBuffer(
        submission.audioKey,
      );
    } catch (storageErr: any) {
      this.logger.error(
        `Failed to download audio for submission #${submissionId}: ${storageErr.message}`,
      );
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

    // 3. Call Azure Speech via AiService
    let assessmentResult: any;
    try {
      assessmentResult = await this.aiService.assessPronunciation(
        submission.exercise.targetText,
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
        provider: 'azure',
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

    // 6. Gamification reward idempotency check
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
