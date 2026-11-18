import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { GamificationService } from './gamification.service';

/**
 * A badge earned by two paths at the same moment, a quiz job and a badge
 * page load for instance (audit C5, 2026-11-18). The badge was found, then
 * created: the second create failed on the unique (userId, badgeId), and in
 * the quiz job that one error skipped the submission's Bánh Mì and quests.
 */
describeWithIsolatedDatabase('awardBadgeIfEarned race', () => {
  let prisma: PrismaService;
  let service: GamificationService;
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  let userId: number;
  let badgeId: number;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new GamificationService(
      prisma,
      { emit: jest.fn() } as never,
      {} as never,
    );
    userId = (
      await prisma.user.create({
        data: { email: `badge_race_${suffix}@breadtrans.local` },
      })
    ).id;
    badgeId = (
      await prisma.badge.create({
        data: {
          name: `QA badge race ${suffix}`,
          description: 'QA',
          criteria: { type: 'QA' },
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.userBadge.deleteMany({ where: { badgeId } });
    await prisma.badge.delete({ where: { id: badgeId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('two awards at once: both succeed, one badge, one says it was new', async () => {
    const name = `QA badge race ${suffix}`;
    const results = await Promise.allSettled([
      service.awardBadgeIfEarned(userId, name),
      service.awardBadgeIfEarned(userId, name),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const newOnes = results.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    );
    expect(newOnes).toHaveLength(1);
    expect(await prisma.userBadge.count({ where: { userId, badgeId } })).toBe(
      1,
    );
  });
});
