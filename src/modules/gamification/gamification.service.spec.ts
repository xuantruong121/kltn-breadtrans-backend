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
});
