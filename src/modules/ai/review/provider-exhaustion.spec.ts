/* eslint-disable @typescript-eslint/require-await */
import {
  exhaustedUntil,
  exhaustionKey,
  exhaustionUntil,
  markExhausted,
  shortRetryDelayMs,
} from './provider-exhaustion';

describe('shortRetryDelayMs', () => {
  it('a 429 asking to wait up to a minute is worth one retry after the wait', () => {
    expect(shortRetryDelayMs({ status: 429, retryAfterSeconds: 2 })).toBe(2000);
    expect(shortRetryDelayMs({ status: 429, retryAfterSeconds: 1.5 })).toBe(
      2000,
    );
    expect(shortRetryDelayMs({ status: 429, retryAfterSeconds: 60 })).toBe(
      60_000,
    );
    // "retry now" still waits a second
    expect(shortRetryDelayMs({ status: 429, retryAfterSeconds: 0 })).toBe(1000);
  });

  it('no retry-after, a spent quota, or another error is not retried', () => {
    expect(shortRetryDelayMs({ status: 429 })).toBeNull();
    expect(
      shortRetryDelayMs({ status: 429, retryAfterSeconds: 61 }),
    ).toBeNull();
    expect(shortRetryDelayMs({ status: 503, retryAfterSeconds: 2 })).toBeNull();
    expect(shortRetryDelayMs(new Error('down'))).toBeNull();
  });
});

const now = new Date('2026-11-04T15:22:00.000Z');
const cloudflareDaily = new Error(
  'Cloudflare Workers AI: AiError: AiError: you have used up your daily free allocation of 10,000 neurons, please upgrade',
);

describe('exhaustionUntil', () => {
  it('Cloudflare daily allocation: spent until 00:00 UTC', () => {
    expect(exhaustionUntil('cloudflare', cloudflareDaily, now)).toEqual(
      new Date('2026-11-05T00:00:00.000Z'),
    );
  });

  it('a 429 with a long retry-after is a spent quota until then', () => {
    expect(
      exhaustionUntil(
        'openai-compatible',
        { status: 429, retryAfterSeconds: 3600 },
        now,
      ),
    ).toEqual(new Date(now.getTime() + 3600_000));
  });

  it('a short 429, an outage, or a quota message from another provider says nothing', () => {
    expect(
      exhaustionUntil(
        'openai-compatible',
        { status: 429, retryAfterSeconds: 2 },
        now,
      ),
    ).toBeNull();
    expect(
      exhaustionUntil('openai-compatible', { status: 429 }, now),
    ).toBeNull();
    expect(exhaustionUntil('cloudflare', { status: 503 }, now)).toBeNull();
    expect(exhaustionUntil('gemini', cloudflareDaily, now)).toBeNull();
  });
});

describe('Redis record', () => {
  function fakeRedis() {
    const store = new Map<string, string>();
    return {
      store,
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    };
  }

  it('records a spent provider with a TTL up to the reset, and reads it back until then', async () => {
    const redis = fakeRedis();
    const until = await markExhausted(
      redis as any,
      'cloudflare',
      cloudflareDaily,
      now,
    );
    expect(redis.set).toHaveBeenCalledWith(
      exhaustionKey('cloudflare'),
      '2026-11-05T00:00:00.000Z',
      'PX',
      until!.getTime() - now.getTime(),
    );
    expect(await exhaustedUntil(redis as any, 'cloudflare', now)).toEqual(
      until,
    );
    expect(
      await exhaustedUntil(
        redis as any,
        'cloudflare',
        new Date('2026-11-05T00:00:01.000Z'),
      ),
    ).toBeNull();
  });

  it('records nothing for an error that is not about quota, and survives a broken Redis', async () => {
    const redis = fakeRedis();
    expect(
      await markExhausted(redis as any, 'cloudflare', { status: 503 }, now),
    ).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
    const broken = {
      get: jest.fn().mockRejectedValue(new Error('down')),
      set: jest.fn().mockRejectedValue(new Error('down')),
    };
    expect(await exhaustedUntil(broken as any, 'cloudflare', now)).toBeNull();
    expect(
      await markExhausted(broken as any, 'cloudflare', cloudflareDaily, now),
    ).not.toBeNull();
  });
});
