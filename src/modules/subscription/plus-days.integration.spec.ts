import {
  PlanStatus,
  PlanVersionStatus,
  SubscriptionEventType,
  SubscriptionSource,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { givePlusDays } from './plus-days';

/**
 * Plus days given at the same moment as other plan writes (audit R3,
 * 2026-11-18): the shop's 7-day card and a referral reward both read the
 * plan's end, then wrote an absolute end, with no lock on the learner. Two
 * at once kept only one of them.
 */
describeWithIsolatedDatabase('givePlusDays under concurrency', () => {
  let prisma: PrismaService;
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  let planId: number;
  let versionId: number;
  const userIds: number[] = [];
  const DAY = 86_400_000;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    planId = (
      await prisma.plan.create({
        data: {
          code: `TEST_PLUSDAYS_${suffix}`,
          displayName: 'Plus days test',
          status: PlanStatus.ACTIVE,
        },
      })
    ).id;
    versionId = (
      await prisma.planVersion.create({
        data: {
          planId,
          version: 1,
          displayName: 'Plus days test',
          durationDays: 30,
          priceVnd: 99000,
          currency: 'VND',
          status: PlanVersionStatus.PUBLISHED,
          isCurrent: false,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.subscriptionEvent.deleteMany({
      where: { subscription: { userId: { in: userIds } } },
    });
    await prisma.subscription.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.planVersion.delete({ where: { id: versionId } });
    await prisma.plan.delete({ where: { id: planId } });
    await prisma.$disconnect();
  });

  it('two grants of 7 days at once add 14 days', async () => {
    for (let run = 0; run < 5; run += 1) {
      const user = await prisma.user.create({
        data: { email: `plus_days_${suffix}_${run}@breadtrans.local` },
      });
      userIds.push(user.id);
      const now = new Date();
      const endsAt = new Date(now.getTime() + 10 * DAY);
      const sub = await prisma.subscription.create({
        data: {
          userId: user.id,
          planVersionId: versionId,
          status: SubscriptionStatus.ACTIVE,
          source: SubscriptionSource.PURCHASE,
          startsAt: now,
          endsAt,
        },
      });
      const grant = () =>
        prisma.$transaction((tx) =>
          givePlusDays(tx, {
            userId: user.id,
            days: 7,
            now,
            source: SubscriptionSource.MARKET,
            eventType: SubscriptionEventType.MARKET_REWARD,
            reason: 'QA plus days race',
            metadata: { run },
          }),
        );

      await Promise.all([grant(), grant()]);

      const after = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(after.endsAt.getTime()).toBe(endsAt.getTime() + 14 * DAY);
    }
  });
});
