/**
 * Fail-closed target selection for mutation-capable QA scripts (CP60.2).
 *
 * CP60/CP60.1 ran "harness" suites whose helpers silently fell back to the
 * backend `.env` (kltn_db) and the owner app (:3000/:3001). Every
 * mutation-capable QA workflow now has to name an isolated environment
 * explicitly, and the names are not trusted on their own: the database and
 * Redis identities are read and compared with the protected ones, and the
 * backend is shown to use that database and that Redis before a test goes on.
 *
 *   QA_TARGET=isolated                       explicit environment selection
 *   QA_FRONTEND_URL / RECOVERY_FE_BASE_URL   e.g. http://localhost:3100
 *   QA_BACKEND_URL  / SMOKE_BASE_URL         e.g. http://localhost:3101
 *   QA_DATABASE_URL / GLOBAL_AUDIT_DATABASE_URL  the backend's database
 *   QA_REDIS_URL                             the backend's Redis
 *
 * Nothing falls back to `.env`, NODE_ENV or a default port.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import IORedis from 'ioredis';

import {
  verifyDatabaseTarget,
  verifyRedisTarget,
} from '../../test/safety/target-identity';
import { redactUrl } from '../../test/safety/test-target-guard';

export type Verdict = { ok: true } | { ok: false; reason: string };

/** The owner's running app; QA never mutates through it. */
export const OWNER_APP_PORTS = ['3000', '3001'];

export type IsolatedTargets = {
  frontendUrl: string;
  backendUrl: string;
  databaseUrl: string;
  redisUrl: string;
};

const first = (env: NodeJS.ProcessEnv, ...names: string[]) =>
  names.map((n) => env[n]).find((v) => typeof v === 'string' && v.length > 0);

/** An app base URL: http(s), and never the owner's :3000/:3001. */
export function assessAppUrl(label: string, url: string | undefined): Verdict {
  if (!url) return { ok: false, reason: `${label} is not set` };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `${label} is not a URL` };
  }
  if (!/^https?:$/.test(parsed.protocol))
    return { ok: false, reason: `${label} must be http(s)` };
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  if (OWNER_APP_PORTS.includes(port))
    return {
      ok: false,
      reason: `${label} points at the owner app (port ${port}); QA must use the isolated harness`,
    };
  return { ok: true };
}

/** The backend `.env` values, parsed (never loaded into process.env). */
export function ownerEnv(
  envFile = join(__dirname, '..', '..', '.env'),
): Record<string, string> {
  return existsSync(envFile) ? parse(readFileSync(envFile)) : {};
}

/**
 * Synchronous checks: explicit selection, every target present, no owner
 * ports, no value inherited from `.env`. Returns the targets or a reason.
 */
export function readIsolatedTargets(
  env: NodeJS.ProcessEnv = process.env,
  owner: Record<string, string> = ownerEnv(),
): { ok: true; targets: IsolatedTargets } | { ok: false; reason: string } {
  if (env.QA_TARGET !== 'isolated')
    return {
      ok: false,
      reason:
        'QA_TARGET=isolated is required: mutation-capable QA has no default environment',
    };
  const targets = {
    frontendUrl: first(env, 'QA_FRONTEND_URL', 'RECOVERY_FE_BASE_URL'),
    backendUrl: first(env, 'QA_BACKEND_URL', 'SMOKE_BASE_URL'),
    databaseUrl: first(env, 'QA_DATABASE_URL', 'GLOBAL_AUDIT_DATABASE_URL'),
    redisUrl: first(env, 'QA_REDIS_URL'),
  };
  for (const [label, value] of Object.entries(targets))
    if (!value) return { ok: false, reason: `${label} is not set` };
  for (const [label, url] of [
    ['QA frontend', targets.frontendUrl],
    ['QA backend', targets.backendUrl],
  ] as const) {
    const v = assessAppUrl(label, url);
    if (!v.ok) return v;
  }
  for (const key of ['DATABASE_URL', 'SHADOW_DATABASE_URL'])
    if (owner[key] && owner[key] === targets.databaseUrl)
      return {
        ok: false,
        reason: `QA database equals .env ${key} (${redactUrl(owner[key])}): inherited target refused`,
      };
  if (owner.REDIS_URL && owner.REDIS_URL === targets.redisUrl)
    return {
      ok: false,
      reason: 'QA Redis equals .env REDIS_URL: inherited target refused',
    };
  return { ok: true, targets: targets as IsolatedTargets };
}

/**
 * Full pre-mutation check: the synchronous rules plus the real identities of
 * the database (not kltn_db / kltn_shadow / their clusters) and Redis (not
 * the shared 6379 instance). Throws with the reason; never mutates.
 */
export async function assertIsolatedTargets(
  env: NodeJS.ProcessEnv = process.env,
): Promise<IsolatedTargets> {
  const read = readIsolatedTargets(env);
  if (!read.ok) throw new Error(`QA target refused: ${read.reason}`);
  const db = await verifyDatabaseTarget(read.targets.databaseUrl);
  if (!db.ok) throw new Error(`QA target refused: database ${db.reason}`);
  const redis = await verifyRedisTarget(read.targets.redisUrl);
  if (!redis.ok) throw new Error(`QA target refused: Redis ${redis.reason}`);
  return read.targets;
}

/**
 * After the first QA learner exists in the verified database: the backend
 * must log it in (so the backend reads that database) and the session must
 * appear in the verified Redis (so the backend writes that Redis). Call
 * before any further mutation; on failure the caller removes the learner.
 */
export async function assertBackendUsesTargets(
  targets: IsolatedTargets,
  learner: { userId: number; email: string; password: string },
): Promise<string> {
  const res = await fetch(`${targets.backendUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: learner.email, password: learner.password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { accessToken?: string; access_token?: string };
  };
  const token = body.data?.accessToken ?? body.data?.access_token;
  if (!res.ok || !token)
    throw new Error(
      `QA target refused: the backend at ${targets.backendUrl} cannot log in a learner created in the verified database (HTTP ${res.status})`,
    );
  const redis = new IORedis(targets.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    const [, keys] = await redis.scan(
      '0',
      'MATCH',
      `user:${learner.userId}:device:*`,
      'COUNT',
      1000,
    );
    if (keys.length === 0)
      throw new Error(
        'QA target refused: the backend did not write the login session to the verified Redis',
      );
  } finally {
    redis.disconnect();
  }
  return token;
}

/**
 * Opt-ins that are never implied: an owner read-only smoke, a read from the
 * real R2 private bucket, a real paid provider call.
 */
export function requireExplicitOptIn(
  name:
    | 'QA_OWNER_READONLY'
    | 'QA_ALLOW_REAL_R2_READ'
    | 'QA_ALLOW_REAL_PROVIDER'
    | 'QA_LEGACY_SCRIPT_OWNER_APPROVED',
  what: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env[name] !== 'owner-approved')
    throw new Error(
      `${what}: refused without ${name}=owner-approved (an explicit owner decision for this run)`,
    );
}
