import { GamificationService } from './gamification.service';

/**
 * The ranking's activity feed records a new XP level and a streak milestone
 * as they happen (owner 2026-11-08), once each.
 */
describe('learner events for the ranking feed', () => {
  function setup(
    totalBefore: number,
    streak: { count: number; daysAgo: number },
  ) {
    const events: { type: string; value: number }[] = [];
    const notices: { type: string; title: string }[] = [];
    const lastStreakUpdate = new Date(Date.now() - streak.daysAgo * 86_400_000);
    const tx: any = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
      leaderboard: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(({ data }: any) =>
          Promise.resolve({
            userId: 1,
            totalPoints: totalBefore + data.totalPoints.increment,
          }),
        ),
      },
      pointHistory: { create: jest.fn() },
      userStats: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 1,
          streakCount: streak.count,
          streakFreezes: 0,
          lastStreakUpdate,
        }),
        update: jest.fn(),
        create: jest.fn(),
      },
      learnerEvent: {
        create: jest.fn(({ data }: any) => {
          events.push({ type: data.type, value: data.value });
          return Promise.resolve(data);
        }),
      },
      notification: {
        create: jest.fn(({ data }: any) => {
          notices.push({ type: data.type, title: data.title });
          return Promise.resolve(data);
        }),
      },
    };
    const service = new GamificationService(
      tx as never,
      { emit: jest.fn() } as never,
      {} as never,
    );
    return { service, tx, events, notices };
  }

  it('crossing 100 XP records LEVEL_UP to Lv. 2, once', async () => {
    const { service, tx, events } = setup(90, { count: 0, daysAgo: 0 });
    await service.awardXp(1, 20, 'test', { tx });
    expect(events).toEqual([{ type: 'LEVEL_UP', value: 2 }]);
  });

  it('a new level also leaves one line in Thông báo (owner 24/11)', async () => {
    const { service, tx, notices } = setup(90, { count: 0, daysAgo: 0 });
    await service.awardXp(1, 20, 'test', { tx });
    expect(notices).toEqual([
      { type: 'level_up:2', title: 'Bạn đã lên Cấp 2' },
    ]);
  });

  it('XP inside a level records nothing', async () => {
    const { service, tx, events, notices } = setup(110, {
      count: 0,
      daysAgo: 0,
    });
    await service.awardXp(1, 20, 'test', { tx });
    expect(events).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('the day a streak reaches 7 records STREAK_MILESTONE 7', async () => {
    const { service, tx, events } = setup(110, { count: 6, daysAgo: 1 });
    await service.awardXp(1, 5, 'test', { tx });
    expect(events).toEqual([{ type: 'STREAK_MILESTONE', value: 7 }]);
  });

  it('a streak going from 7 to 8 records nothing', async () => {
    const { service, tx, events } = setup(110, { count: 7, daysAgo: 1 });
    await service.awardXp(1, 5, 'test', { tx });
    expect(events).toEqual([]);
  });
});
