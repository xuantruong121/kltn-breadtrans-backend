import { RANKING_CACHE_MS, RankingService } from './ranking.service';

/** Capacity run 2026-11-09: standings are computed once a minute. */
describe('RankingService standings', () => {
  // 60 learners with weekly XP 600, 590, ... 10; user 1000 + i.
  const board = Array.from({ length: 60 }, (_, i) => ({
    userId: 1000 + i,
    weeklyExp: 600 - i * 10,
    totalPoints: 5000 - i,
  }));
  const make = () => {
    const prisma = {
      leaderboard: {
        findMany: jest.fn().mockResolvedValue(board),
        findUnique: jest.fn(({ where }: { where: { userId: number } }) =>
          Promise.resolve(board.find((b) => b.userId === where.userId) ?? null),
        ),
        count: jest.fn().mockResolvedValue(0),
      },
      user: {
        findMany: jest.fn(({ where }: { where: { id: { in: number[] } } }) =>
          Promise.resolve(
            where.id.in.map((id) => ({
              id,
              profile: { fullName: `Learner ${id}`, avatar: null },
              leaderboard: { tier: 'Đồng', totalPoints: 100 },
            })),
          ),
        ),
      },
    };
    return { prisma, service: new RankingService(prisma as never) };
  };
  afterEach(() => jest.useRealTimers());

  it('lists the top 50, counts everyone, and ranks a learner outside the top 50', async () => {
    const { service } = make();
    const out = await service.getRanking('xp', 'week', 1055);
    expect(out.entries).toHaveLength(50);
    expect(out.entries[0]).toMatchObject({ rank: 1, userId: 1000, value: 600 });
    expect(out.total).toBe(60);
    // 1055 has 50 XP; 55 learners have more.
    expect(out.me).toMatchObject({ rank: 56, value: 50 });
  });

  it('a second learner within the minute costs no ranking query', async () => {
    const { prisma, service } = make();
    await service.getRanking('xp', 'week', 1001);
    await service.getRanking('xp', 'week', 1059);
    expect(prisma.leaderboard.findMany).toHaveBeenCalledTimes(1);
    // People of the top list are read once; each learner's own row is read live.
    expect(prisma.user.findMany).toHaveBeenCalledTimes(3);
  });

  it('computes the standings again after a minute', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-09T05:00:00Z') });
    const { prisma, service } = make();
    await service.getRanking('xp', 'week', 1001);
    jest.setSystemTime(
      new Date('2026-11-09T05:00:00Z').getTime() + RANKING_CACHE_MS + 1,
    );
    await service.getRanking('xp', 'week', 1001);
    expect(prisma.leaderboard.findMany).toHaveBeenCalledTimes(2);
  });

  it('a learner with no XP has no rank', async () => {
    const { service } = make();
    const out = await service.getRanking('xp', 'week', 5);
    expect(out.me).toMatchObject({ rank: null, value: 0 });
  });
});
