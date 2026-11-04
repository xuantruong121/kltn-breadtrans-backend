import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PlanPurchaseStatus,
  PlanVersionStatus,
  Prisma,
  ReferralStatus,
  SubscriptionEventType,
  SubscriptionSource,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  REFERRAL_CLAIM_DAYS,
  REFERRAL_REWARD_DAYS,
  decideClaim,
  newReferralCode,
  normalizeReferralCode,
  rewardPlacement,
} from './referral.logic';

export type ReferralSummary = {
  code: string;
  invited: number;
  rewarded: number;
  rewardDays: number;
  /** The code this learner entered, when they were invited. */
  invitedBy: { status: 'PENDING' | 'REWARDED' } | null;
  /** Whether this learner can still enter someone else's code. */
  canClaim: boolean;
};

@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

  /** The learner's own code (made on first request) and how it did. */
  async summary(userId: number): Promise<ReferralSummary> {
    let own = await this.prisma.referralCode.findUnique({ where: { userId } });
    for (let attempt = 0; !own; attempt += 1) {
      try {
        own = await this.prisma.referralCode.create({
          data: { userId, code: newReferralCode() },
        });
      } catch (error) {
        const collision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!collision || attempt >= 4) throw error;
        // Another request made the row, or the random code exists: retry.
        own = await this.prisma.referralCode.findUnique({ where: { userId } });
      }
    }
    const [invited, rewarded, mine, user, paid] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: userId } }),
      this.prisma.referral.count({
        where: { referrerId: userId, status: ReferralStatus.REWARDED },
      }),
      this.prisma.referral.findUnique({ where: { inviteeId: userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      }),
      this.prisma.planPurchase.count({
        where: { userId, status: PlanPurchaseStatus.COMPLETED },
      }),
    ]);
    const canClaim =
      !mine &&
      paid === 0 &&
      !!user &&
      Date.now() - user.createdAt.getTime() <=
        REFERRAL_CLAIM_DAYS * 24 * 60 * 60 * 1000;
    return {
      code: own.code,
      invited,
      rewarded,
      rewardDays: REFERRAL_REWARD_DAYS,
      invitedBy: mine ? { status: mine.status } : null,
      canClaim,
    };
  }

  /** A new learner enters the code of the friend who invited them. */
  async claim(userId: number, rawCode: string): Promise<ReferralSummary> {
    const code = normalizeReferralCode(rawCode);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
      );
      const [owner, invitee, already, paid] = await Promise.all([
        tx.referralCode.findUnique({ where: { code } }),
        tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { createdAt: true },
        }),
        tx.referral.findUnique({ where: { inviteeId: userId } }),
        tx.planPurchase.count({
          where: { userId, status: PlanPurchaseStatus.COMPLETED },
        }),
      ]);
      const decision = decideClaim({
        referrerId: owner?.userId ?? null,
        inviteeId: userId,
        inviteeCreatedAt: invitee.createdAt,
        now: new Date(),
        alreadyReferred: !!already,
        inviteePaidPurchases: paid,
      });
      if (!decision.ok) throw new BadRequestException(decision.message);
      await tx.referral.create({
        data: { referrerId: owner!.userId, inviteeId: userId },
      });
    });
    return this.summary(userId);
  }

  /**
   * Called inside the payment confirmation: the invitee's first completed
   * purchase rewards both sides with 7 days. Runs once per referral.
   */
  async rewardOnFirstPayment(
    tx: Prisma.TransactionClient,
    purchase: { id: number; userId: number },
    now: Date,
  ): Promise<void> {
    const referral = await tx.referral.findUnique({
      where: { inviteeId: purchase.userId },
    });
    if (!referral || referral.status !== ReferralStatus.PENDING) return;
    const earlier = await tx.planPurchase.count({
      where: {
        userId: purchase.userId,
        status: PlanPurchaseStatus.COMPLETED,
        id: { not: purchase.id },
      },
    });
    if (earlier > 0) return;
    await tx.referral.update({
      where: { id: referral.id },
      data: {
        status: ReferralStatus.REWARDED,
        rewardPurchaseId: purchase.id,
        rewardedAt: now,
      },
    });
    for (const userId of [referral.inviteeId, referral.referrerId]) {
      await this.giveRewardDays(tx, userId, now, referral.id);
    }
  }

  private async giveRewardDays(
    tx: Prisma.TransactionClient,
    userId: number,
    now: Date,
    referralId: number,
  ) {
    const terms = await tx.subscription.findMany({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
        planVersion: { plan: { code: { not: 'FREE' } } },
      },
      select: { id: true, endsAt: true, source: true },
    });
    const placement = rewardPlacement({ now, paidTerms: terms });
    let subscriptionId: number;
    let previousEndsAt: Date | null = null;
    let newEndsAt: Date;
    if (placement.kind === 'EXTEND') {
      previousEndsAt =
        terms.find((t) => t.id === placement.subscriptionId)?.endsAt ?? null;
      await tx.subscription.update({
        where: { id: placement.subscriptionId },
        data: { endsAt: placement.newEndsAt },
      });
      subscriptionId = placement.subscriptionId;
      newEndsAt = placement.newEndsAt;
    } else {
      // A running trial ends now: the reward is a real PLUS week.
      await tx.subscription.updateMany({
        where: {
          userId,
          source: SubscriptionSource.TRIAL,
          status: SubscriptionStatus.ACTIVE,
          endsAt: { gt: now },
        },
        data: { endsAt: now },
      });
      const plus = await tx.planVersion.findFirst({
        where: {
          plan: { code: 'PLUS' },
          status: PlanVersionStatus.PUBLISHED,
          isCurrent: true,
          durationDays: 30,
        },
        select: { id: true },
      });
      if (!plus) return;
      const sub = await tx.subscription.create({
        data: {
          userId,
          planVersionId: plus.id,
          status: SubscriptionStatus.ACTIVE,
          source: SubscriptionSource.REFERRAL,
          startsAt: placement.startsAt,
          endsAt: placement.endsAt,
        },
      });
      subscriptionId = sub.id;
      newEndsAt = placement.endsAt;
    }
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId,
        type: SubscriptionEventType.REFERRAL_REWARD,
        reason: `Thưởng giới thiệu bạn bè: +${REFERRAL_REWARD_DAYS} ngày`,
        previousEndsAt,
        newEndsAt,
        metadata: { referralId, placement: placement.kind },
      },
    });
    await tx.notification.create({
      data: {
        userId,
        type: `referral_reward:${referralId}:${userId}`,
        title: `Bạn được thêm ${REFERRAL_REWARD_DAYS} ngày học`,
        body:
          placement.kind === 'EXTEND'
            ? `Nhờ lời giới thiệu, gói của bạn được cộng thêm ${REFERRAL_REWARD_DAYS} ngày.`
            : `Nhờ lời giới thiệu, bạn được dùng Plus ${REFERRAL_REWARD_DAYS} ngày từ hôm nay.`,
        url: '/plans',
      },
    });
  }
}
