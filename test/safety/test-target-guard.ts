/**
 * Fail-closed target checks for every test that can reach a real database or
 * Redis (C3-INC-001).
 *
 * Integration specs used `new PrismaService()` with no URL, so Prisma fell
 * back to `.env` and wrote to the protected development database. Tests now
 * never see the ordinary DATABASE_URL/REDIS_URL: they get either an
 * explicitly configured TEST_* target whose identity was verified, or a
 * sentinel that cannot connect anywhere.
 *
 * Pure functions here; the connecting checks live in jest-global-setup.ts.
 */

/** Databases that hold real data or the Prisma shadow. Never a test target. */
export const PROTECTED_DATABASE_NAMES = ['kltn_db', 'kltn_shadow'];

/**
 * PostgreSQL cluster identities (pg_control_system().system_identifier) of
 * the protected containers: kltn-postgres (5432, also hosts kltn_test_db) and
 * kltn-postgres-shadow (5433). Any database on these clusters is refused.
 * The global setup also adds the identities it can read from `.env`.
 */
export const PROTECTED_CLUSTER_IDENTITIES = [
  '7674533776495505443',
  '7699757546958700579',
];

/** Local ports published by the protected containers. */
export const PROTECTED_LOCAL_PG_PORTS = ['5432', '5433'];
export const SHARED_REDIS_PORT = '6379';

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'host.docker.internal',
]);

/**
 * Used when no verified target exists. Port 9 (discard) on loopback refuses
 * connections, so any client that tries to use it fails at once, and Prisma
 * does not fall back to `.env` because the variable is set.
 */
export const SENTINEL_DATABASE_URL =
  'postgresql://refused:refused@127.0.0.1:9/no_isolated_test_database';
export const SENTINEL_REDIS_URL = 'redis://127.0.0.1:9/0';

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

const refuse = (reason: string): GuardVerdict => ({ ok: false, reason });

/** Strip credentials before a URL is shown anywhere. */
export function redactUrl(url: string): string {
  return url.replace(/\/\/([^:@/]*)(:[^@/]*)?@/, '//***@');
}

/** Static checks that need no connection. */
export function assessDatabaseUrl(url: string | undefined): GuardVerdict {
  if (!url || !url.trim())
    return refuse('TEST_DATABASE_URL is not set; no isolated database');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse('TEST_DATABASE_URL is not a valid URL');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol))
    return refuse(`unsupported protocol ${parsed.protocol}`);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) return refuse('TEST_DATABASE_URL names no database');
  if (PROTECTED_DATABASE_NAMES.includes(database.toLowerCase()))
    return refuse(`database ${database} is protected`);
  const port = parsed.port || '5432';
  if (
    LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) &&
    PROTECTED_LOCAL_PG_PORTS.includes(port)
  )
    return refuse(
      `local port ${port} belongs to a protected PostgreSQL container`,
    );
  return { ok: true };
}

export type DatabaseIdentity = {
  database: string;
  systemIdentifier: string;
};

/** The authoritative check: what the connection actually reached. */
export function assessDatabaseIdentity(
  identity: DatabaseIdentity,
  protectedIdentities: readonly string[],
): GuardVerdict {
  if (!identity.systemIdentifier)
    return refuse('cluster identity could not be read');
  if (protectedIdentities.includes(identity.systemIdentifier))
    return refuse(
      `connection reached protected cluster ${identity.systemIdentifier}`,
    );
  if (PROTECTED_DATABASE_NAMES.includes(identity.database.toLowerCase()))
    return refuse(`connection reached protected database ${identity.database}`);
  return { ok: true };
}

export function assessRedisUrl(url: string | undefined): GuardVerdict {
  if (!url || !url.trim())
    return refuse('TEST_REDIS_URL is not set; no isolated Redis');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse('TEST_REDIS_URL is not a valid URL');
  }
  if (!/^rediss?:$/.test(parsed.protocol))
    return refuse(`unsupported protocol ${parsed.protocol}`);
  if ((parsed.port || SHARED_REDIS_PORT) === SHARED_REDIS_PORT)
    return refuse('port 6379 is the shared Redis of the running application');
  return { ok: true };
}

/**
 * Redis has no cluster identifier, but every server has a run_id. A target
 * whose run_id equals the shared server's is the shared server, whatever
 * host or port alias reached it.
 */
export function assessRedisIdentity(
  targetRunId: string | null,
  sharedRunId: string | null,
): GuardVerdict {
  if (!targetRunId) return refuse('Redis identity could not be read');
  if (sharedRunId && targetRunId === sharedRunId)
    return refuse('connection reached the shared Redis on 6379');
  return { ok: true };
}

/** Marker the global setup writes once a target is verified. */
export function verificationToken(url: string): string {
  // Not a secret; only binds the verification to this exact URL.
  let hash = 0;
  for (const ch of url) hash = (Math.imul(31, hash) + ch.charCodeAt(0)) | 0;
  return `verified:${(hash >>> 0).toString(16)}`;
}

export const DB_VERIFIED_ENV = 'BREADTRANS_TEST_DB_VERIFIED';
export const REDIS_VERIFIED_ENV = 'BREADTRANS_TEST_REDIS_VERIFIED';
