import {
  PLAN_STREAK_FREEZE_TYPE,
  grantPlanStreakFreezes,
} from './plan-streak-freezes';

describe('grantPlanStreakFreezes', () => {
  function tx() {
    return {
      userStats: { upsert: jest.fn() },
      notification: { create: jest.fn() },
    };
  }

  it('gives a Plus plan of 30 days one freeze and tells the learner', async () => {
    const t = tx();
    const given = await grantPlanStreakFreezes(t as any, {
      userId: 7,
      planCode: 'PLUS',
      durationDays: 30,
    });
    expect(given).toBe(1);
    expect(t.userStats.upsert).toHaveBeenCalledWith({
      where: { userId: 7 },
      create: { userId: 7, streakFreezes: 1 },
      update: { streakFreezes: { increment: 1 } },
    });
    expect(t.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 7,
        type: PLAN_STREAK_FREEZE_TYPE,
        title: 'Gói Plus tặng bạn 1 khiên giữ chuỗi',
        url: '/dashboard',
      }),
    });
  });

  it('gives a Pro plan three freezes for each 30 days', async () => {
    const t = tx();
    expect(
      await grantPlanStreakFreezes(t as any, {
        userId: 7,
        planCode: 'PRO',
        durationDays: 90,
      }),
    ).toBe(9);
    expect(t.userStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { streakFreezes: { increment: 9 } } }),
    );
    expect(t.notification.create.mock.calls[0][0].data.title).toBe(
      'Gói Pro tặng bạn 9 khiên giữ chuỗi',
    );
  });

  it('writes nothing when the plan gives none', async () => {
    for (const input of [
      { planCode: 'FREE', durationDays: 30 },
      { planCode: 'PRO', durationDays: 7 },
      { planCode: 'PLUS', durationDays: null },
      { planCode: null, durationDays: 30 },
    ]) {
      const t = tx();
      expect(
        await grantPlanStreakFreezes(t as any, { userId: 7, ...input }),
      ).toBe(0);
      expect(t.userStats.upsert).not.toHaveBeenCalled();
      expect(t.notification.create).not.toHaveBeenCalled();
    }
  });
});
