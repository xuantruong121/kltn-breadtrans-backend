/**
 * Jest globalSetup for test/jest-e2e.json (C3-INC-001).
 *
 * Replaces the former setup-env.js, which accepted `kltn_test_db` on the
 * protected kltn-postgres cluster (5432) and let AppModule fall back to the
 * shared Redis on 6379 because `.env.test` sets no REDIS_URL.
 *
 * E2E boots the whole application, so both targets are REQUIRED and both are
 * verified by identity: a disposable PostgreSQL cluster that is not a
 * protected one, and a Redis that is not the shared server. Anything else
 * aborts the run before a test module is loaded.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { config } from 'dotenv';

import { redactUrl, SENTINEL_DATABASE_URL } from './test-target-guard';
import { verifyDatabaseTarget, verifyRedisTarget } from './target-identity';

export default async function e2eGlobalSetup(): Promise<void> {
  const envPath = join(__dirname, '..', '..', '.env.test');
  if (existsSync(envPath))
    config({ path: envPath, override: true, quiet: true });

  const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const db = await verifyDatabaseTarget(dbUrl);
  if (!db.ok)
    throw new Error(
      `[test-safety] E2E REFUSED database ${dbUrl ? redactUrl(dbUrl) : '(unset)'}: ${db.reason}. ` +
        'Point TEST_DATABASE_URL at a disposable PostgreSQL cluster.',
    );

  const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
  const redis = await verifyRedisTarget(redisUrl);
  if (!redis.ok)
    throw new Error(
      `[test-safety] E2E REFUSED Redis ${redisUrl ? redactUrl(redisUrl) : '(unset)'}: ${redis.reason}. ` +
        'Point TEST_REDIS_URL at a disposable Redis.',
    );

  const r = new URL(redisUrl!);
  process.env.DATABASE_URL = dbUrl;
  process.env.SHADOW_DATABASE_URL = SENTINEL_DATABASE_URL;
  process.env.REDIS_URL = r.toString();
  process.env.REDIS_HOST = r.hostname;
  process.env.REDIS_PORT = r.port;
  console.log(
    `[test-safety] E2E targets verified: ${db.identity?.database} (cluster ${db.identity?.systemIdentifier}), ${redactUrl(redisUrl!)}`,
  );
}
