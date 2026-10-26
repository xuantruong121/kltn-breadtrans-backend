/**
 * Gates for specs that need a real database or Redis. Without a verified
 * isolated target the suite is skipped, loudly, instead of reaching whatever
 * the environment happens to point at.
 */
import {
  DB_VERIFIED_ENV,
  REDIS_VERIFIED_ENV,
  verificationToken,
} from './test-target-guard';

export function hasIsolatedDatabase(): boolean {
  const url = process.env.TEST_DATABASE_URL;
  return (
    !!url &&
    process.env[DB_VERIFIED_ENV] === verificationToken(url) &&
    process.env.DATABASE_URL === url
  );
}

export function hasIsolatedRedis(): boolean {
  const url = process.env.TEST_REDIS_URL;
  return (
    !!url &&
    process.env[REDIS_VERIFIED_ENV] === verificationToken(url) &&
    new URL(process.env.REDIS_URL ?? '').toString() === new URL(url).toString()
  );
}

function gated(
  name: string,
  needs: { database?: boolean; redis?: boolean },
): jest.Describe {
  const missing = [
    needs.database && !hasIsolatedDatabase() ? 'TEST_DATABASE_URL' : null,
    needs.redis && !hasIsolatedRedis() ? 'TEST_REDIS_URL' : null,
  ].filter(Boolean);
  if (!missing.length) return describe;
  console.warn(
    `[test-safety] SKIPPED "${name}": needs a verified isolated ${missing.join(' and ')}`,
  );
  return describe.skip;
}

export const describeWithIsolatedDatabase = (
  name: string,
  fn: () => void,
): void => gated(name, { database: true })(name, fn);

export const describeWithIsolatedRedis = (name: string, fn: () => void): void =>
  gated(name, { redis: true })(name, fn);

export const describeWithIsolatedDatabaseAndRedis = (
  name: string,
  fn: () => void,
): void => gated(name, { database: true, redis: true })(name, fn);
