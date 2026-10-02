import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import type { PronunciationFeedback } from '../ai/strategies/ai-evaluator.interface';
import { GamificationListener } from '../gamification/gamification.listener';
import {
  SPEAKING_EVENTS_CHANNEL,
  SPEAKING_FEEDBACK_COMPLETED_EVENT,
  SPEAKING_FEEDBACK_FAILED_EVENT,
  SPEAKING_REWARD_COMPLETED_EVENT,
  getLeaseTimeoutMs,
  getSpeakingWorkerConfig,
} from './speaking.constants';
import IORedis from 'ioredis';

const MAX_ATTEMPTS = 4;

@Injectable()
export class SpeakingPostProcessingService implements OnModuleDestroy {
  private readonly logger = new Logger(SpeakingPostProcessingService.name);
  private readonly pubRedis: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly gamificationListener: GamificationListener,
  ) {
    this.pubRedis = new IORedis(
      process.env.REDIS_URL || 'redis://localhost:6379',
      {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    );
  }

  async processFeedback(
    submissionId: number,
    traceId: string,
    attempt = 1,
    maxAttempts = MAX_ATTEMPTS,
  ): Promise<void> {
    const feedbackStartedAt = Date.now();
    const submission = await this.prisma.speakingSubmission.findUnique({
      where: { id: submissionId },
      include: { exercise: true },
    });
    if (!submission || submission.status !== 'COMPLETED') return;
    if (submission.feedbackStatus === 'COMPLETED') return;

    const leaseTimeoutMs = getLeaseTimeoutMs(
      getSpeakingWorkerConfig().jobTimeoutMs,
    );
    const leaseCutoff = new Date(Date.now() - leaseTimeoutMs);
    const workerToken = `feedback-${crypto.randomUUID()}`;

    const claim = await this.prisma.speakingSubmission.updateMany({
      where: {
        id: submissionId,
        status: 'COMPLETED',
        OR: [
          { feedbackStatus: 'PENDING' },
          {
            feedbackStatus: 'PROCESSING',
            feedbackStartedAt: { lte: leaseCutoff },
          },
        ],
      },
      data: {
        feedbackStatus: 'PROCESSING',
        feedbackStartedAt: new Date(),
        feedbackWorkerId: workerToken,
        feedbackError: null,
      },
    });
    if (claim.count === 0) return;

    try {
      const assessment =
        submission.aiFeedback && typeof submission.aiFeedback === 'object'
          ? (submission.aiFeedback as Record<string, unknown>)
          : {};
      const feedback = await this.aiService.generatePronunciationFeedback(
        submission.exercise.targetText,
        assessment as unknown as PronunciationFeedback,
      );
      const merged = { ...assessment, ...feedback };
      const feedbackPersistStartedAt = Date.now();
      const persist = await this.prisma.speakingSubmission.updateMany({
        where: {
          id: submissionId,
          status: 'COMPLETED',
          feedbackStatus: 'PROCESSING',
          feedbackWorkerId: workerToken,
        },
        data: {
          aiFeedback: merged,
          feedbackStatus: 'COMPLETED',
          feedbackProcessedAt: new Date(),
          feedbackError: null,
        },
      });
      if (persist.count === 0) {
        this.logger.warn(
          `[SpeakingPostProcessing] Stale feedback worker token ${workerToken} for #${submissionId}. Discarding write.`,
        );
        return;
      }
      await this.publish(
        SPEAKING_FEEDBACK_COMPLETED_EVENT,
        submission.userId,
        submissionId,
        traceId,
      );
      this.logger.log(
        `[LATENCY_INSTRUMENTATION] ${JSON.stringify({ tag: 'speaking_feedback_metrics', submissionId, geminiFeedbackMs: feedbackPersistStartedAt - feedbackStartedAt, feedbackPersistMs: Date.now() - feedbackPersistStartedAt })}`,
      );
    } catch (error: any) {
      const terminal = attempt >= maxAttempts;
      await this.prisma.speakingSubmission.updateMany({
        where: {
          id: submissionId,
          status: 'COMPLETED',
          feedbackStatus: 'PROCESSING',
          feedbackWorkerId: workerToken,
        },
        data: {
          feedbackStatus: terminal ? 'FAILED' : 'PENDING',
          feedbackError: String(
            error?.message || 'Feedback generation failed',
          ).slice(0, 1000),
          ...(terminal ? { feedbackProcessedAt: new Date() } : {}),
        },
      });
      if (terminal) {
        await this.publish(
          SPEAKING_FEEDBACK_FAILED_EVENT,
          submission.userId,
          submissionId,
          traceId,
        );
        this.logger.error(
          `[SpeakingPostProcessing] Feedback failed permanently for #${submissionId}: ${error?.message}`,
        );
        return;
      }
      throw error;
    }
  }

  async processReward(
    submissionId: number,
    traceId: string,
    attempt = 1,
    maxAttempts = MAX_ATTEMPTS,
  ): Promise<void> {
    const rewardStartedAt = Date.now();
    const submission = await this.prisma.speakingSubmission.findUnique({
      where: { id: submissionId },
    });
    if (
      !submission ||
      submission.status !== 'COMPLETED' ||
      submission.overallScore == null
    )
      return;
    if (
      submission.rewardStatus === 'COMPLETED' ||
      submission.rewardGrantedAt !== null
    )
      return;

    const leaseTimeoutMs = getLeaseTimeoutMs(
      getSpeakingWorkerConfig().jobTimeoutMs,
    );
    const leaseCutoff = new Date(Date.now() - leaseTimeoutMs);
    const workerToken = `reward-${crypto.randomUUID()}`;

    const claim = await this.prisma.speakingSubmission.updateMany({
      where: {
        id: submissionId,
        status: 'COMPLETED',
        rewardGrantedAt: null,
        OR: [
          { rewardStatus: 'PENDING' },
          {
            rewardStatus: 'PROCESSING',
            rewardStartedAt: { lte: leaseCutoff },
          },
        ],
      },
      data: {
        rewardStatus: 'PROCESSING',
        rewardStartedAt: new Date(),
        rewardWorkerId: workerToken,
        rewardError: null,
      },
    });
    if (claim.count === 0) return;

    try {
      await this.gamificationListener.handleSpeakingSubmittedEvent(
        {
          submissionId: submission.id,
          userId: submission.userId,
          exerciseId: submission.exerciseId,
          overallScore: submission.overallScore,
          isSilentOrNoSpeech: false,
        },
        { rethrow: true },
      );
      const persist = await this.prisma.speakingSubmission.updateMany({
        where: {
          id: submissionId,
          status: 'COMPLETED',
          rewardStatus: 'PROCESSING',
          rewardWorkerId: workerToken,
        },
        data: {
          rewardStatus: 'COMPLETED',
          rewardGrantedAt: new Date(),
          rewardProcessedAt: new Date(),
          rewardError: null,
        },
      });
      if (persist.count === 0) {
        this.logger.warn(
          `[SpeakingPostProcessing] Stale reward worker token ${workerToken} for #${submissionId}. Discarding write.`,
        );
        return;
      }
      await this.publish(
        SPEAKING_REWARD_COMPLETED_EVENT,
        submission.userId,
        submissionId,
        traceId,
      );
      this.logger.log(
        `[LATENCY_INSTRUMENTATION] ${JSON.stringify({ tag: 'speaking_reward_metrics', submissionId, gamificationMs: Date.now() - rewardStartedAt })}`,
      );
    } catch (error: any) {
      const terminal = attempt >= maxAttempts;
      await this.prisma.speakingSubmission.updateMany({
        where: {
          id: submissionId,
          status: 'COMPLETED',
          rewardStatus: 'PROCESSING',
          rewardWorkerId: workerToken,
        },
        data: {
          rewardStatus: terminal ? 'FAILED' : 'PENDING',
          rewardError: String(
            error?.message || 'Reward processing failed',
          ).slice(0, 1000),
          ...(terminal ? { rewardProcessedAt: new Date() } : {}),
        },
      });
      if (terminal) {
        this.logger.error(
          `[SpeakingPostProcessing] Reward failed permanently for #${submissionId}: ${error?.message}`,
        );
        return;
      }
      throw error;
    }
  }

  private async publish(
    type: string,
    userId: number,
    submissionId: number,
    traceId: string,
  ): Promise<void> {
    await this.pubRedis.publish(
      SPEAKING_EVENTS_CHANNEL,
      JSON.stringify({ type, userId, submissionId, traceId }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pubRedis.status !== 'end') await this.pubRedis.quit();
  }
}
