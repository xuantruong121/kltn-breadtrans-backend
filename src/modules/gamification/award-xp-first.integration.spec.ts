import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { GamificationService } from './gamification.service';

/**
 * A new learner's first two XP awards at the same moment (two queue jobs, or
 * a quiz and a speaking reward). The Leaderboard row is made on the first
 * award; before the upsert, the second create failed with P2002 and the
 * reward of that submission was lost (audit C4, 2026-11-18).
 */
describeWithIsolatedDatabase(
  'GamificationService.awardXp, first award race',
  () => {
    let prisma: PrismaService;
    let service: GamificationService;
    const createdUserIds: number[] = [];
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
      service = new GamificationService(
        prisma,
        { emit: jest.fn() } as never,
        {} as never,
      );
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.$disconnect();
    });

    it('two first awards at once both count', async () => {
      const user = await prisma.user.create({
        data: { email: `xp_first_${suffix}@breadtrans.local` },
      });
      createdUserIds.push(user.id);

      const results = await Promise.allSettled([
        service.awardXp(user.id, 30, 'QA first award A'),
        service.awardXp(user.id, 50, 'QA first award B'),
      ]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      const board = await prisma.leaderboard.findUnique({
        where: { userId: user.id },
      });
      expect(board?.totalPoints).toBe(80);
      expect(
        await prisma.pointHistory.count({ where: { userId: user.id } }),
      ).toBe(2);
    });
  },
);
