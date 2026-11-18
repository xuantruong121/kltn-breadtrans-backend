import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import {
  ARENA_XP_DAILY_CAP,
  ARENA_XP_REASON,
} from '../events/arena-questions.logic';
import { GamificationService } from './gamification.service';

/**
 * Two Arena games (Pháo, Hầm, Song Đấu) ending at the same moment near the
 * 150 XP daily cap (audit R6, 2026-11-18): each read today's Arena XP before
 * the other's award, so both were paid in full.
 */
describeWithIsolatedDatabase('GamificationService.awardArenaXp cap', () => {
  let prisma: PrismaService;
  let service: GamificationService;
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userIds: number[] = [];

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
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('two games ending at once never take today past the cap', async () => {
    for (let run = 0; run < 5; run += 1) {
      const user = await prisma.user.create({
        data: { email: `arena_cap_${suffix}_${run}@breadtrans.local` },
      });
      userIds.push(user.id);
      // 140 of 150 already earned today.
      await service.awardXp(user.id, ARENA_XP_DAILY_CAP - 10, ARENA_XP_REASON);
      const tenUnderCap = (earned: number) =>
        Math.max(0, Math.min(10, ARENA_XP_DAILY_CAP - earned));

      const paid = await Promise.all([
        service.awardArenaXp(user.id, ARENA_XP_REASON, tenUnderCap),
        service.awardArenaXp(user.id, ARENA_XP_REASON, tenUnderCap),
      ]);

      expect(paid.sort()).toEqual([0, 10]);
      const total = await prisma.pointHistory.aggregate({
        where: { userId: user.id, reason: ARENA_XP_REASON },
        _sum: { points: true },
      });
      expect(total._sum.points).toBe(ARENA_XP_DAILY_CAP);
    }
  });
});
