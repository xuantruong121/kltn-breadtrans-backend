import { GamificationService } from './gamification.service';
import {
  STREAK_SHIELD_USED_TYPE,
  isStreakShieldProduct,
  streakShieldUsedNotice,
} from './streak-shield.logic';

describe('streak-shield.logic', () => {
  it('says which streak a shield kept and how many are left', () => {
    expect(streakShieldUsedNotice({ streak: 6, remaining: 2 })).toEqual({
      type: STREAK_SHIELD_USED_TYPE,
      title: 'Khiên giữ chuỗi đã giữ chuỗi 6 ngày của bạn',
      body: 'Bạn đã lỡ một ngày học nên 1 khiên giữ chuỗi được dùng tự động. Bạn còn 2 khiên.',
      url: '/dashboard',
    });
  });

  it('warns when the last shield was used', () => {
    expect(streakShieldUsedNotice({ streak: 3, remaining: 0 }).body).toBe(
      'Bạn đã lỡ một ngày học nên 1 khiên giữ chuỗi được dùng tự động. Bạn đã hết khiên: lỡ thêm một ngày nữa thì chuỗi sẽ về 0.',
    );
  });

  it('knows a shield in the shop by its slug or an older name', () => {
    expect(isStreakShieldProduct({ slug: 'streak-freeze', name: 'X' })).toBe(
      true,
    );
    expect(isStreakShieldProduct({ name: 'Khiên giữ chuỗi' })).toBe(true);
    expect(
      isStreakShieldProduct({ name: 'Vé bảo vệ chuỗi học (Streak Freeze)' }),
    ).toBe(true);
    expect(
      isStreakShieldProduct({ slug: 'double-bread', name: 'Thẻ nhân đôi' }),
    ).toBe(false);
  });
});

describe('a shield in use tells the learner', () => {
  it('the nightly rollover uses one shield and writes one notice in the same transaction', async () => {
    const tx: any = {
      userStats: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 10,
              userId: 77,
              streakCount: 5,
              streakFreezes: 2,
              lastStreakUpdate: new Date('2026-09-10T00:00:00Z'),
            },
          ])
          .mockResolvedValueOnce([]),
        update: jest.fn().mockResolvedValue({}),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
      gameSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prisma: any = {
      $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
    };
    const service = new GamificationService(
      prisma,
      { emit: jest.fn() } as any,
      {} as any,
    );

    await service.triggerDailyCron('2026-09-16');

    expect(tx.userStats.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({ streakFreezes: { decrement: 1 } }),
    });
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 77,
        ...streakShieldUsedNotice({ streak: 5, remaining: 1 }),
      },
    });
  });

  it('a learner without a shield loses the streak and gets no shield notice', async () => {
    const tx: any = {
      userStats: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 11,
              userId: 78,
              streakCount: 5,
              streakFreezes: 0,
              lastStreakUpdate: new Date('2026-09-10T00:00:00Z'),
            },
          ])
          .mockResolvedValueOnce([]),
        update: jest.fn().mockResolvedValue({}),
      },
      notification: { create: jest.fn() },
      gameSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prisma: any = {
      $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
    };
    const service = new GamificationService(
      prisma,
      { emit: jest.fn() } as any,
      {} as any,
    );

    await service.triggerDailyCron('2026-09-16');

    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('studying again after missed days uses one shield and says so', async () => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      userStats: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 15,
          streakCount: 4,
          streakFreezes: 1,
          lastStreakUpdate: new Date(Date.now() - 3 * 86_400_000),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
      learnerEvent: { create: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
    };
    const service = new GamificationService(
      prisma,
      { emit: jest.fn() } as any,
      {} as any,
    );

    await service.recordStreakActivity(15);

    expect(tx.userStats.update).toHaveBeenCalledWith({
      where: { userId: 15 },
      data: expect.objectContaining({ streakFreezes: { decrement: 1 } }),
    });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 15,
        ...streakShieldUsedNotice({ streak: 4, remaining: 0 }),
      },
    });
  });
});
