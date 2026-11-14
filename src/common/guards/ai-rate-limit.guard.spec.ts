import { HttpException, UnauthorizedException } from '@nestjs/common';

import { AiRateLimitGuard, aiQuotaKey } from './ai-rate-limit.guard';

describe('AiRateLimitGuard', () => {
  function setup(options: {
    plan?: 'FREE' | 'PLUS' | 'PRO';
    used: number;
    user?: { id: number; role: string } | null;
    withSubscriptions?: boolean;
  }) {
    const redis = {
      incr: jest.fn().mockResolvedValue(options.used),
      expire: jest.fn(),
    };
    const subscriptions = {
      planCodeFor: jest.fn().mockResolvedValue(options.plan ?? 'FREE'),
    };
    const headers: Record<string, unknown> = {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user:
            options.user === undefined
              ? { id: 7, role: 'STUDENT' }
              : options.user,
        }),
        getResponse: () => ({
          setHeader: (name: string, value: unknown) => {
            headers[name] = value;
          },
        }),
      }),
    };
    const guard = new AiRateLimitGuard(
      redis as any,
      options.withSubscriptions === false ? undefined : (subscriptions as any),
    );
    return { guard, redis, subscriptions, headers, context: context as any };
  }

  const status = async (run: Promise<boolean>) => {
    try {
      await run;
      return 200;
    } catch (error) {
      return (error as HttpException).getStatus();
    }
  };

  it.each([
    ['FREE', 10],
    ['PLUS', 30],
    ['PRO', 60],
  ] as const)(
    'lets a %s learner have %i gradings a day and no more',
    async (plan, limit) => {
      const last = setup({ plan, used: limit });
      expect(await last.guard.canActivate(last.context)).toBe(true);
      expect(last.headers).toEqual({
        'X-AI-Quota-Limit': limit,
        'X-AI-Quota-Remaining': 0,
      });
      const over = setup({ plan, used: limit + 1 });
      expect(await status(over.guard.canActivate(over.context))).toBe(429);
    },
  );

  it('says which plan ran out and what the next plan gives', async () => {
    const { guard, context } = setup({ plan: 'FREE', used: 11 });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: {
        statusCode: 429,
        error: 'AI_QUOTA_EXHAUSTED',
        limit: 10,
        currentUsage: 11,
        planCode: 'FREE',
        message:
          'Bạn đã dùng hết 10 lượt AI chấm của hôm nay (gói Free). Lượt chấm được làm mới vào ngày mai. Gói Plus có 30 lượt mỗi ngày.',
      },
    });
  });

  it('counts per learner and per Vietnam day', async () => {
    // 23:30 UTC on the 10th is 06:30 on the 11th in Vietnam.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-10T23:30:00Z'));
    try {
      const { guard, context, redis } = setup({ used: 1 });
      await guard.canActivate(context);
      expect(redis.incr).toHaveBeenCalledWith(aiQuotaKey(7, '2026-11-11'));
      expect(redis.expire).toHaveBeenCalledWith(
        'ai_quota:7:2026-11-11',
        2 * 86400,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives the Free number when no plan can be read', async () => {
    const { guard, context } = setup({ used: 11, withSubscriptions: false });
    expect(await status(guard.canActivate(context))).toBe(429);
    const ok = setup({ used: 10, withSubscriptions: false });
    expect(await ok.guard.canActivate(ok.context)).toBe(true);
  });

  it('does not limit an admin, and counts nothing for one', async () => {
    const { guard, context, redis, subscriptions } = setup({
      used: 999,
      user: { id: 1, role: 'ADMIN' },
    });
    expect(await guard.canActivate(context)).toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(subscriptions.planCodeFor).not.toHaveBeenCalled();
  });

  it('refuses a request that is not signed in', async () => {
    const { guard, context, redis } = setup({ used: 1, user: null });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(redis.incr).not.toHaveBeenCalled();
  });
});
