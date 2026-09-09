import { GamificationService } from './gamification.service';

describe('GamificationService weekly cron hardening', () => {
  it('uses a fixed snapshot and records the processed week in GameSettings', async () => {
    const updates: any[] = [];
    const tx: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([]),
      gameSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      leaderboard: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, tier: 'Đồng', weeklyExp: 100 },
          { id: 2, tier: 'Đồng', weeklyExp: 50 },
          { id: 3, tier: 'Bạc', weeklyExp: 10 },
        ]),
        update: jest.fn().mockImplementation((args) => {
          updates.push(args);
          return args;
        }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };
    const redis = { set: jest.fn() };
    const service = new GamificationService(prisma, {} as any, redis as any);

    const result = await service.triggerWeeklyCron();

    expect(result.success).toBe(true);
    expect(updates.find((u) => u.where.id === 1).data.tier).toBe('Bạc');
    expect(updates.find((u) => u.where.id === 2).data.tier).toBe('Đồng');
    expect(updates.find((u) => u.where.id === 3).data.tier).toBe('Vàng');
    expect(tx.gameSettings.upsert).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalled();
  });

  it('returns no-op when the database advisory lock is unavailable', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: false }]),
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };
    const service = new GamificationService(
      prisma,
      {} as any,
      { set: jest.fn() } as any,
    );

    const result = await service.triggerWeeklyCron();

    expect(result).toEqual({
      success: true,
      noop: true,
      message: 'Weekly cron đang được xử lý bởi tiến trình khác.',
    });
  });

  it('uses completed quest count for dashboard summary percentage', async () => {
    const quests = [
      {
        id: 1,
        type: 'LEARN_VOCAB',
        title: 'Học 10 từ vựng',
        description: 'Học từ mới',
        targetValue: 10,
        rewardXP: 15,
        rewardBanh: 5,
      },
      {
        id: 2,
        type: 'COMPLETE_QUIZ',
        title: 'Làm 1 bài luyện nghe',
        description: 'Hoàn thành bài nghe',
        targetValue: 1,
        rewardXP: 20,
        rewardBanh: 8,
      },
      {
        id: 3,
        type: 'DO_SPEAKING',
        title: 'Luyện Speaking',
        description: 'Nộp bài nói',
        targetValue: 1,
        rewardXP: 25,
        rewardBanh: 10,
      },
      {
        id: 4,
        type: 'COMPLETE_LESSON',
        title: 'Hoàn thành bài học',
        description: 'Xem xong lesson',
        targetValue: 1,
        rewardXP: 20,
        rewardBanh: 8,
      },
    ];
    const prisma: any = {
      dailyQuest: { findMany: jest.fn().mockResolvedValue(quests) },
      userQuestProgress: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 101,
            questId: 1,
            currentValue: 10,
            isCompleted: true,
            quest: quests[0],
          },
          {
            id: 102,
            questId: 2,
            currentValue: 0,
            isCompleted: false,
            quest: quests[1],
          },
          {
            id: 103,
            questId: 3,
            currentValue: 0,
            isCompleted: false,
            quest: quests[2],
          },
          {
            id: 104,
            questId: 4,
            currentValue: 0,
            isCompleted: false,
            quest: quests[3],
          },
        ]),
      },
      learningActivity: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new GamificationService(
      prisma,
      {} as any,
      { set: jest.fn() } as any,
    );

    const result = await service.getDashboardToday(1);

    expect(result.summary).toEqual(
      expect.objectContaining({
        completedCount: 1,
        totalCount: 4,
        progressPercent: 25,
      }),
    );
    expect(result.quests[0].progressPercent).toBe(100);
  });
});
