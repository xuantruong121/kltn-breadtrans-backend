import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { getBusinessDayKey } from '../../common/time/business-time.util';
import { SubscriptionService } from '../subscription/subscription.service';
import { AiService } from './ai.service';
import { TutorContextService } from './tutor-context.service';
import type { TutorContextRef } from './tutor-context.logic';
import {
  TUTOR_UNAVAILABLE_MESSAGE,
  buildTutorPrompt,
  tutorDailyLimit,
  tutorLimitMessage,
  tutorQuotaKey,
  type TutorContext,
  type TutorTurn,
} from './tutor-prompt.logic';

export type TutorQuota = { limit: number; remaining: number };
export type TutorReply = {
  reply: string;
  quota: TutorQuota;
  /** True when the answer is the "no questions left today" notice. */
  limited: boolean;
};

/**
 * Answers a learner as the tutor: one place for the daily limit of the
 * learner's plan, the prompt and the provider call, used by the chat endpoint
 * and by the support conversation.
 */
@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);

  constructor(
    private readonly aiService: AiService,
    @InjectRedis() private readonly redis: Redis,
    @Optional() private readonly subscriptions?: SubscriptionService,
    @Optional() private readonly contexts?: TutorContextService,
  ) {}

  private async limitFor(userId: number): Promise<number> {
    try {
      const plan = await this.subscriptions?.resolveEffectivePlan(userId);
      return tutorDailyLimit(plan?.plan.code);
    } catch (error) {
      this.logger.warn(`Plan lookup failed for ${userId}: ${String(error)}`);
      return tutorDailyLimit(null);
    }
  }

  async quota(userId: number): Promise<TutorQuota> {
    const limit = await this.limitFor(userId);
    const used = Number(
      (await this.redis.get(tutorQuotaKey(userId, getBusinessDayKey()))) ?? 0,
    );
    return { limit, remaining: Math.max(0, limit - used) };
  }

  async reply(
    userId: number,
    input: {
      message: string;
      history?: TutorTurn[];
      context?: TutorContext | null;
      /** Ids of the item asked about; the item itself is read on the server. */
      contextRef?: TutorContextRef | null;
      learnerNotes?: string[];
    },
  ): Promise<TutorReply> {
    const limit = await this.limitFor(userId);
    const key = tutorQuotaKey(userId, getBusinessDayKey());
    const used = await this.redis.incr(key);
    if (used === 1) await this.redis.expire(key, 2 * 86400);
    if (used > limit) {
      return {
        reply: tutorLimitMessage(limit),
        quota: { limit, remaining: 0 },
        limited: true,
      };
    }
    const quota = { limit, remaining: Math.max(0, limit - used) };
    try {
      const context =
        input.context ??
        (input.contextRef && this.contexts
          ? await this.contexts.load(userId, input.contextRef)
          : null);
      const reply = await this.aiService.tutorChat(
        buildTutorPrompt({ ...input, context }),
      );
      return { reply, quota, limited: false };
    } catch (error) {
      // A failed call does not cost the learner a question.
      await this.redis.decr(key);
      this.logger.error(`Tutor reply failed: ${String(error)}`);
      return {
        reply: TUTOR_UNAVAILABLE_MESSAGE,
        quota: { limit, remaining: quota.remaining + 1 },
        limited: false,
      };
    }
  }
}
