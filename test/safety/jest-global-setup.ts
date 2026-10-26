/**
 * Jest globalSetup for the unit/integration suite (C3-INC-001).
 *
 * - No TEST_DATABASE_URL / TEST_REDIS_URL: nothing is verified; specs that
 *   need a real database or Redis are skipped, and every other spec sees
 *   sentinel URLs (see jest-setup-isolation.ts).
 * - Set but unsafe, or identity unverifiable: the whole run is aborted.
 * - Set and verified: the verification is recorded for the test workers.
 */
import {
  DB_VERIFIED_ENV,
  redactUrl,
  REDIS_VERIFIED_ENV,
  verificationToken,
} from './test-target-guard';
import { verifyDatabaseTarget, verifyRedisTarget } from './target-identity';

export default async function globalSetup(): Promise<void> {
  delete process.env[DB_VERIFIED_ENV];
  delete process.env[REDIS_VERIFIED_ENV];

  const dbUrl = process.env.TEST_DATABASE_URL;
  if (dbUrl) {
    const verdict = await verifyDatabaseTarget(dbUrl);
    if (!verdict.ok)
      throw new Error(
        `[test-safety] REFUSED TEST_DATABASE_URL ${redactUrl(dbUrl)}: ${verdict.reason}`,
      );
    process.env[DB_VERIFIED_ENV] = verificationToken(dbUrl);
    console.log(
      `[test-safety] isolated database verified: ${verdict.identity?.database} (cluster ${verdict.identity?.systemIdentifier})`,
    );
  }

  const redisUrl = process.env.TEST_REDIS_URL;
  if (redisUrl) {
    const verdict = await verifyRedisTarget(redisUrl);
    if (!verdict.ok)
      throw new Error(
        `[test-safety] REFUSED TEST_REDIS_URL ${redactUrl(redisUrl)}: ${verdict.reason}`,
      );
    process.env[REDIS_VERIFIED_ENV] = verificationToken(redisUrl);
    console.log(
      `[test-safety] isolated Redis verified: ${redactUrl(redisUrl)}`,
    );
  }
}
