import {
  PlanVersionStatus,
  Prisma,
  SubscriptionEventType,
  SubscriptionSource,
  SubscriptionStatus,
} from '@prisma/client';
import { rewardPlacement } from './referral.logic';

export type PlusDaysResult = {
  placement: 'EXTEND' | 'GRANT';
  subscriptionId: number;
  newEndsAt: Date;
};

/**
 * Gives a learner `days` more days of study, inside the caller's transaction:
 * the paid plan that ends last (running or queued) is extended, so a renewal
 * still queues after it; with no paid plan a PLUS term starts now and a
 * running trial ends. Shared by the referral reward and the shop's 7-day Plus
 * card. Returns null when no current 30-day PLUS version is published, so the
 * caller can refuse rather than take payment for nothing.
 */
export async function givePlusDays(
  tx: Prisma.TransactionClient,
  input: {
    userId: number;
    days: number;
    now: Date;
    source: SubscriptionSource;
    eventType: SubscriptionEventType;
    reason: string;
    metadata: Prisma.InputJsonValue;
  },
): Promise<PlusDaysResult | null> {
  const { userId, days, now } = input;
  const terms = await tx.subscription.findMany({
    where: {
      userId,
      status: SubscriptionStatus.ACTIVE,
      endsAt: { gt: now },
      planVersion: { plan: { code: { not: 'FREE' } } },
    },
    select: { id: true, endsAt: true, source: true },
  });
  const placement = rewardPlacement({ now, paidTerms: terms, days });
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
    const plus = await tx.planVersion.findFirst({
      where: {
        plan: { code: 'PLUS' },
        status: PlanVersionStatus.PUBLISHED,
        isCurrent: true,
        durationDays: 30,
      },
      select: { id: true },
    });
    if (!plus) return null;
    // A running trial ends now: the reward is a real PLUS term.
    await tx.subscription.updateMany({
      where: {
        userId,
        source: SubscriptionSource.TRIAL,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
      },
      data: { endsAt: now },
    });
    const sub = await tx.subscription.create({
      data: {
        userId,
        planVersionId: plus.id,
        status: SubscriptionStatus.ACTIVE,
        source: input.source,
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
      type: input.eventType,
      reason: input.reason,
      previousEndsAt,
      newEndsAt,
      metadata: { ...(input.metadata as object), placement: placement.kind },
    },
  });
  return { placement: placement.kind, subscriptionId, newEndsAt };
}
