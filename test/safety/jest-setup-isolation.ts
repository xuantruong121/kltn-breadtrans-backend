/**
 * Runs in every test worker before any spec module loads (C3-INC-001).
 *
 * The ordinary DATABASE_URL / SHADOW_DATABASE_URL / REDIS_URL / REDIS_HOST /
 * REDIS_PORT are always overwritten. A spec sees the TEST_* target only when
 * the global setup verified that exact URL; otherwise it sees a sentinel that
 * refuses connections. Because the variables are set, Prisma never falls back
 * to `.env`.
 */
import {
  DB_VERIFIED_ENV,
  REDIS_VERIFIED_ENV,
  SENTINEL_DATABASE_URL,
  SENTINEL_REDIS_URL,
  verificationToken,
} from './test-target-guard';

const dbUrl = process.env.TEST_DATABASE_URL;
const dbVerified =
  !!dbUrl && process.env[DB_VERIFIED_ENV] === verificationToken(dbUrl);
process.env.DATABASE_URL = dbVerified ? dbUrl : SENTINEL_DATABASE_URL;
process.env.SHADOW_DATABASE_URL = SENTINEL_DATABASE_URL;

const redisUrl = process.env.TEST_REDIS_URL;
const redisVerified =
  !!redisUrl && process.env[REDIS_VERIFIED_ENV] === verificationToken(redisUrl);
const redis = new URL(redisVerified ? redisUrl : SENTINEL_REDIS_URL);
process.env.REDIS_URL = redis.toString();
process.env.REDIS_HOST = redis.hostname;
process.env.REDIS_PORT = redis.port;
