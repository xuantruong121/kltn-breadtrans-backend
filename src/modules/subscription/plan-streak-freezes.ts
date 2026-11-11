import type { Prisma } from '@prisma/client';

import { PLAN_LABEL, planCodeOf, streakFreezesForPlan } from './plan-limits';

/** Notification type of the streak freezes that come with a plan. */
export const PLAN_STREAK_FREEZE_TYPE = 'plan_streak_freeze';

/**
 * Gives the streak freezes that come with a bought or granted plan
 * (plan-limits.ts: 1 per 30 days on Plus, 3 on Pro) and tells the learner.
 * Runs inside the transaction that creates the subscription, so each plan
 * gives its freezes once. Returns how many were given.
 */
export async function grantPlanStreakFreezes(
  tx: Prisma.TransactionClient,
  input: {
    userId: number;
    planCode: string | null | undefined;
    durationDays: number | null | undefined;
  },
): Promise<number> {
  const count = streakFreezesForPlan(input.planCode, input.durationDays);
  if (count <= 0) return 0;
  await tx.userStats.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, streakFreezes: count },
    update: { streakFreezes: { increment: count } },
  });
  await tx.notification.create({
    data: {
      userId: input.userId,
      type: PLAN_STREAK_FREEZE_TYPE,
      title: `Gói ${PLAN_LABEL[planCodeOf(input.planCode)]} tặng bạn ${count} khiên giữ chuỗi`,
      body: 'Khiên giữ chuỗi tự được dùng khi bạn lỡ một ngày học, để chuỗi ngày của bạn không bị mất.',
      url: '/dashboard',
    },
  });
  return count;
}
