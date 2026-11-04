import type Redis from 'ioredis';

/**
 * A provider that has used up its quota stays unusable until the quota
 * resets; calling it again only adds a failed request. This decides from an
 * error when that is, and keeps the answer in Redis so every caller skips the
 * provider until then.
 */
export type QuotaProvider = 'cloudflare' | 'gemini' | 'openai-compatible';

const CLOUDFLARE_DAILY = /daily free allocation|used up your daily/i;
/** A 429 asking to wait longer than this is a spent quota, not a burst. */
const LONG_WAIT_SECONDS = 60;

function nextUtcMidnight(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}

/** When the provider can be used again, or null when this error says nothing about quota. */
export function exhaustionUntil(
  provider: QuotaProvider,
  error: unknown,
  now: Date,
): Date | null {
  const message = String((error as Error)?.message ?? error);
  // Workers AI free allocation resets at 00:00 UTC.
  if (provider === 'cloudflare' && CLOUDFLARE_DAILY.test(message))
    return nextUtcMidnight(now);
  const status = Number(
    (error as any)?.status ?? (error as any)?.statusCode ?? NaN,
  );
  const retryAfter = Number((error as any)?.retryAfterSeconds);
  if (
    status === 429 &&
    Number.isFinite(retryAfter) &&
    retryAfter > LONG_WAIT_SECONDS
  )
    return new Date(now.getTime() + retryAfter * 1000);
  return null;
}

export const exhaustionKey = (provider: QuotaProvider) =>
  `ai:provider-exhausted:${provider}`;

/** The time the provider is spent until, if it is spent now. */
export async function exhaustedUntil(
  redis: Redis | undefined,
  provider: QuotaProvider,
  now = new Date(),
): Promise<Date | null> {
  if (!redis) return null;
  try {
    const value = await redis.get(exhaustionKey(provider));
    const until = value ? new Date(value) : null;
    return until && until.getTime() > now.getTime() ? until : null;
  } catch {
    // Redis down: behave as before (try the provider).
    return null;
  }
}

/** Records the spent quota; a no-op when the error is not about quota. */
export async function markExhausted(
  redis: Redis | undefined,
  provider: QuotaProvider,
  error: unknown,
  now = new Date(),
): Promise<Date | null> {
  const until = exhaustionUntil(provider, error, now);
  if (!until || !redis) return until;
  try {
    await redis.set(
      exhaustionKey(provider),
      until.toISOString(),
      'PX',
      Math.max(1000, until.getTime() - now.getTime()),
    );
  } catch {
    // Not recording only costs a failed call later.
  }
  return until;
}
