/* eslint-disable @typescript-eslint/require-await */
import { HttpException } from '@nestjs/common';

import {
  FAIL_WINDOW_SECONDS,
  LOCK_AT,
  LoginGuard,
  waitAfterFailure,
} from './login-guard';

function memoryRedis() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    values,
    ttls,
    incr: jest.fn(async (k: string) => {
      const n = Number(values.get(k) ?? 0) + 1;
      values.set(k, String(n));
      return n;
    }),
    expire: jest.fn(async (k: string, s: number) => {
      ttls.set(k, s);
      return 1;
    }),
    set: jest.fn(async (k: string, v: string, _ex: string, s: number) => {
      values.set(k, v);
      ttls.set(k, s);
      return 'OK';
    }),
    ttl: jest.fn(async (k: string) =>
      values.has(k) ? (ttls.get(k) ?? -1) : -2,
    ),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((k) => {
        values.delete(k);
        ttls.delete(k);
      });
      return keys.length;
    }),
  };
}

describe('login brute-force guard', () => {
  it('waits nothing for 4 failures, then 30 s doubling, then the full lock at 10', () => {
    expect([1, 2, 3, 4].map(waitAfterFailure)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9].map(waitAfterFailure)).toEqual([
      30, 60, 120, 240, 480,
    ]);
    expect(waitAfterFailure(LOCK_AT)).toBe(FAIL_WINDOW_SECONDS);
  });

  it('refuses sign-in with 429 and the wait while locked, and a success clears it', async () => {
    const redis = memoryRedis();
    const guard = new LoginGuard(redis as any);
    for (let i = 0; i < 4; i += 1) await guard.recordFailure('a@b.vn');
    await expect(guard.assertAllowed('a@b.vn')).resolves.toBeUndefined();
    await guard.recordFailure('a@b.vn');
    const error = await guard.assertAllowed('a@b.vn').catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({
      error: 'LOGIN_LOCKED',
      retryAfter: 30,
    });
    // The window starts at the first failure.
    expect(redis.ttls.get('auth:fail:a@b.vn')).toBe(FAIL_WINDOW_SECONDS);
    await guard.recordSuccess('a@b.vn');
    await expect(guard.assertAllowed('a@b.vn')).resolves.toBeUndefined();
  });

  it('counts per e-mail, not across accounts', async () => {
    const guard = new LoginGuard(memoryRedis() as any);
    for (let i = 0; i < 6; i += 1) await guard.recordFailure('x@b.vn');
    await expect(guard.assertAllowed('y@b.vn')).resolves.toBeUndefined();
  });
});
