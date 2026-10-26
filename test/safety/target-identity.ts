/**
 * Connecting identity checks. Every connection here is read-only: PostgreSQL
 * sessions run with default_transaction_read_only=on and only SELECT; Redis
 * is asked for INFO only.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { parse } from 'dotenv';
import IORedis from 'ioredis';

import {
  assessDatabaseIdentity,
  assessDatabaseUrl,
  assessRedisIdentity,
  assessRedisUrl,
  type DatabaseIdentity,
  type GuardVerdict,
  PROTECTED_CLUSTER_IDENTITIES,
  SHARED_REDIS_PORT,
} from './test-target-guard';

const CONNECT_TIMEOUT_MS = 5000;

function readOnly(url: string): string {
  const u = new URL(url);
  u.searchParams.set('options', '-c default_transaction_read_only=on');
  u.searchParams.set('connect_timeout', String(CONNECT_TIMEOUT_MS / 1000));
  return u.toString();
}

export async function readDatabaseIdentity(
  url: string,
): Promise<DatabaseIdentity> {
  const client = new PrismaClient({
    datasources: { db: { url: readOnly(url) } },
    log: [],
  });
  try {
    const [row] = await client.$queryRawUnsafe<
      Array<{ database: string; sysid: string }>
    >(
      `SELECT current_database() AS database,
              (SELECT system_identifier::text FROM pg_control_system()) AS sysid`,
    );
    return { database: row.database, systemIdentifier: row.sysid };
  } finally {
    await client.$disconnect();
  }
}

/**
 * Hard-coded protected identities plus whatever the ordinary `.env` targets
 * currently report, so a recreated protected cluster is still recognised.
 * `.env` is parsed, never loaded into process.env.
 */
export async function protectedIdentities(
  envFile = join(__dirname, '..', '..', '.env'),
): Promise<string[]> {
  const known = new Set(PROTECTED_CLUSTER_IDENTITIES);
  if (!existsSync(envFile)) return [...known];
  const env = parse(readFileSync(envFile));
  for (const key of ['DATABASE_URL', 'SHADOW_DATABASE_URL']) {
    if (!env[key]) continue;
    try {
      known.add((await readDatabaseIdentity(env[key])).systemIdentifier);
    } catch {
      // Unreachable: the hard-coded identities still apply.
    }
  }
  return [...known];
}

export async function verifyDatabaseTarget(
  url: string | undefined,
  protectedIds?: string[],
): Promise<GuardVerdict & { identity?: DatabaseIdentity }> {
  const shape = assessDatabaseUrl(url);
  if (!shape.ok) return shape;
  let identity: DatabaseIdentity;
  try {
    identity = await readDatabaseIdentity(url!);
  } catch (error) {
    return {
      ok: false,
      reason: `identity could not be verified: ${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }`,
    };
  }
  const verdict = assessDatabaseIdentity(
    identity,
    protectedIds ?? (await protectedIdentities()),
  );
  return { ...verdict, identity };
}

async function redisRunId(url: string): Promise<string | null> {
  const client = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: CONNECT_TIMEOUT_MS,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    const info = await client.info('server');
    return /run_id:(\w+)/.exec(info)?.[1] ?? null;
  } catch {
    return null;
  } finally {
    client.disconnect();
  }
}

export async function verifyRedisTarget(
  url: string | undefined,
  sharedUrl = `redis://127.0.0.1:${SHARED_REDIS_PORT}`,
): Promise<GuardVerdict> {
  const shape = assessRedisUrl(url);
  if (!shape.ok) return shape;
  return assessRedisIdentity(
    await redisRunId(url!),
    await redisRunId(sharedUrl),
  );
}
