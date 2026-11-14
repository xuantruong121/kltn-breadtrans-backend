import { HttpException, HttpStatus } from '@nestjs/common';
import type Redis from 'ioredis';

/** Failures are counted per e-mail over this window. */
export const FAIL_WINDOW_SECONDS = 15 * 60;
/** From this failure on, each one adds a growing wait. */
export const DELAY_FROM = 5;
/** At this many failures in the window the account is locked for the window. */
export const LOCK_AT = 10;

const failKey = (email: string) => `auth:fail:${email}`;
const lockKey = (email: string) => `auth:lock:${email}`;

/** Seconds to wait after the nth failure: 30, 60, 120, … then the full lock. */
export function waitAfterFailure(failures: number): number {
  if (failures >= LOCK_AT) return FAIL_WINDOW_SECONDS;
  if (failures < DELAY_FROM) return 0;
  return Math.min(30 * 2 ** (failures - DELAY_FROM), FAIL_WINDOW_SECONDS);
}

const lockedError = (seconds: number) =>
  new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'LOGIN_LOCKED',
      message: `Đăng nhập sai quá nhiều lần. Hãy thử lại sau ${seconds} giây hoặc đặt lại mật khẩu.`,
      retryAfter: seconds,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/**
 * Per-account brute-force guard for password sign-in (owner 2026-11-14,
 * OWASP): counted per e-mail whether or not the account exists, so the
 * answer never tells which e-mails are registered. Password reset stays
 * available while locked.
 */
export class LoginGuard {
  constructor(private readonly redis: Redis) {}

  /** Throws 429 while the e-mail is waiting or locked. */
  async assertAllowed(email: string) {
    const ttl = await this.redis.ttl(lockKey(email));
    if (ttl > 0) throw lockedError(ttl);
  }

  /** Counts a failure and starts the wait it earns. */
  async recordFailure(email: string) {
    const failures = await this.redis.incr(failKey(email));
    if (failures === 1)
      await this.redis.expire(failKey(email), FAIL_WINDOW_SECONDS);
    const wait = waitAfterFailure(failures);
    if (wait > 0) await this.redis.set(lockKey(email), '1', 'EX', wait);
    return { failures, wait };
  }

  async recordSuccess(email: string) {
    await this.redis.del(failKey(email), lockKey(email));
  }
}

/** Wrong OTP entries allowed before the code is thrown away. */
export const OTP_MAX_ATTEMPTS = 5;
