import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  PlanVersionStatus,
  Prisma,
  PrismaClient,
  SubscriptionEventType,
  SubscriptionSource,
  SubscriptionStatus,
} from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TRIAL_DAYS,
  canGrantTrial,
  trialGradingsLeft,
  trialLimitMessage,
  trialWindow,
  type TrialSkill,
} from './trial.logic';

/**
 * Gives the free 3-day PLUS trial once per account and counts its paid-level
 * Speaking/Writing gradings. Called with the plain client by the diagnostic
 * store, so it is a function, not only a service method.
 */
export async function grantPlusTrialOnce(
  db: PrismaClient,
  userId: number,
  now = new Date(),
): Promise<{ subscriptionId: number } | null> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );
    const earlierPlans = await tx.subscription.count({
      where: { userId, planVersion: { plan: { code: { not: 'FREE' } } } },
    });
    if (!canGrantTrial({ earlierPlans })) return null;
    const version = await tx.planVersion.findFirst({
      where: {
        plan: { code: 'PLUS', status: 'ACTIVE' },
        status: PlanVersionStatus.PUBLISHED,
        isCurrent: true,
        durationDays: 30,
      },
      select: { id: true },
    });
    if (!version) return null;
    const { startsAt, endsAt } = trialWindow(now);
    const sub = await tx.subscription.create({
      data: {
        userId,
        planVersionId: version.id,
        status: SubscriptionStatus.ACTIVE,
        source: SubscriptionSource.TRIAL,
        startsAt,
        endsAt,
      },
    });
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: sub.id,
        type: SubscriptionEventType.TRIAL_GRANTED,
        reason: `Dùng thử Plus ${TRIAL_DAYS} ngày sau bài đánh giá đầu vào`,
        previousEndsAt: null,
        newEndsAt: endsAt,
        metadata: { days: TRIAL_DAYS },
      },
    });
    await tx.notification.create({
      data: {
        userId,
        type: `trial:${sub.id}`,
        title: `Bạn được dùng thử Plus ${TRIAL_DAYS} ngày`,
        body: 'Nói và Viết mức Trung cấp đã mở, gồm 5 lượt chấm Nói và 3 lượt chấm Viết. Hết hạn dùng thử, bạn quay về gói Free và không mất dữ liệu học.',
        url: '/plans',
      },
    });
    return { subscriptionId: sub.id };
  });
}

type ActiveTrial = { id: number; startsAt: Date; endsAt: Date };

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {}

  /** The running trial, when the learner has no paid plan of their own. */
  async activeTrial(
    userId: number,
    now = new Date(),
  ): Promise<ActiveTrial | null> {
    const rows = await this.prisma.subscription.findMany({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gt: now },
        planVersion: { plan: { code: { not: 'FREE' } } },
      },
      select: { id: true, startsAt: true, endsAt: true, source: true },
    });
    if (rows.some((r) => r.source !== SubscriptionSource.TRIAL)) return null;
    const trial = rows.find((r) => r.source === SubscriptionSource.TRIAL);
    return trial
      ? { id: trial.id, startsAt: trial.startsAt, endsAt: trial.endsAt }
      : null;
  }

  private key(trialId: number) {
    return `trial:gradings:${trialId}`;
  }

  private async used(trialId: number, skill: TrialSkill): Promise<number> {
    if (!this.redis) return 0;
    try {
      return Number(await this.redis.hget(this.key(trialId), skill)) || 0;
    } catch (error) {
      // A counter outage must not block a learner: the trial fails open.
      this.logger.warn(`trial_counter_read_failed: ${String(error)}`);
      return 0;
    }
  }

  /** Refuses a paid-level grading once the trial's allowance is used. */
  async assertGradingLeft(userId: number, skill: TrialSkill): Promise<void> {
    const trial = await this.activeTrial(userId);
    if (!trial) return;
    const message = trialLimitMessage(skill, await this.used(trial.id, skill));
    if (message) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'TRIAL_GRADING_LIMIT',
        message,
      });
    }
  }

  /**
   * Takes one paid-level grading from a running trial before the work is
   * done, or refuses it (403 TRIAL_GRADING_LIMIT) when none is left (audit
   * R11, 2026-11-18). The check and the count are one HINCRBY: two answers
   * sent at once both passed a check made before either was counted. Returns
   * a refund for a grading that then fails, or null without a trial. A
   * counter outage lets the grading through, as before.
   */
  async takeGrading(
    userId: number,
    skill: TrialSkill,
  ): Promise<(() => Promise<void>) | null> {
    if (!this.redis) return null;
    const redis = this.redis;
    const trial = await this.activeTrial(userId);
    if (!trial) return null;
    const key = this.key(trial.id);
    let usedNow: number;
    try {
      const replies = await redis
        .multi()
        .hincrby(key, skill, 1)
        .pexpireat(key, trial.endsAt.getTime() + 24 * 60 * 60 * 1000)
        .exec();
      const [error, value] = replies?.[0] ?? [null, null];
      if (error) throw error;
      usedNow = Number(value);
    } catch (error) {
      this.logger.warn(`trial_counter_write_failed: ${String(error)}`);
      return null;
    }
    const refund = async () => {
      try {
        await redis.hincrby(key, skill, -1);
      } catch (error) {
        this.logger.warn(`trial_counter_refund_failed: ${String(error)}`);
      }
    };
    const message = trialLimitMessage(skill, usedNow - 1);
    if (message) {
      await refund();
      throw new ForbiddenException({
        statusCode: 403,
        code: 'TRIAL_GRADING_LIMIT',
        message,
      });
    }
    return refund;
  }

  /** For the plan banner: what is left of a running trial, or null. */
  async status(userId: number): Promise<{
    endsAt: string;
    speakingLeft: number;
    writingLeft: number;
  } | null> {
    const trial = await this.activeTrial(userId);
    if (!trial) return null;
    return {
      endsAt: trial.endsAt.toISOString(),
      speakingLeft: trialGradingsLeft(
        'SPEAKING',
        await this.used(trial.id, 'SPEAKING'),
      ),
      writingLeft: trialGradingsLeft(
        'WRITING',
        await this.used(trial.id, 'WRITING'),
      ),
    };
  }
}
