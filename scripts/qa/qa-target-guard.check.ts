/**
 * Negative and positive checks for qa-target-guard (CP60.2). Every refusal
 * must happen before a write. The only connections made to the protected
 * cluster are the guard's own read-only identity query.
 *
 * Needs the harness running (PG :5460 harness_clone + cp601_rehearsal,
 * Redis :6392, API :3101, FE :3100).
 *
 * Run: npx ts-node --transpile-only scripts/qa/qa-target-guard.check.ts
 */
import { execSync, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

import {
  assertIsolatedTargets,
  ownerEnv,
  readIsolatedTargets,
} from './qa-target-guard';
import { check, failureCount } from './harness-api';

const HARNESS = {
  QA_TARGET: 'isolated',
  QA_FRONTEND_URL: 'http://localhost:3100',
  QA_BACKEND_URL: 'http://localhost:3101',
  QA_DATABASE_URL:
    'postgresql://harness:harness-disposable@127.0.0.1:5460/harness_clone',
  QA_REDIS_URL: 'redis://127.0.0.1:6392',
};
const clean = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (/^(QA_|RECOVERY_FE|SMOKE_BASE|GLOBAL_AUDIT)/.test(k)) delete env[k];
  return env;
};
const withEnv = (over: Record<string, string | undefined>) => ({
  ...clean(),
  ...HARNESS,
  ...over,
});

async function refused(env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    await assertIsolatedTargets(env);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Protected-cluster User_id_seq, read-only: must never move. */
const kltnSeq = () =>
  execSync(
    `docker exec kltn-postgres sh -c "psql -U \\"$POSTGRES_USER\\" -d kltn_db -tAc 'select last_value from \\"User_id_seq\\"'"`,
    { encoding: 'utf8' },
  ).trim();
const harnessUsers = (db: string) =>
  execSync(
    `docker exec harness-pg psql -U harness -d ${db} -tAc "select count(*) from \\"User\\""`,
    { encoding: 'utf8' },
  ).trim();

function runScript(file: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const r = spawnSync(
    `npx ts-node --transpile-only ${file} ${args.join(' ')}`,
    { env, shell: true, encoding: 'utf8', timeout: 240_000 },
  );
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

async function main() {
  const seqBefore = kltnSeq();

  console.log('\n== Synchronous rules');
  const none = readIsolatedTargets(clean());
  check(
    'missing explicit selection (no QA_TARGET) is refused',
    !none.ok && /QA_TARGET=isolated is required/.test(none.reason),
  );
  const noDb = readIsolatedTargets(withEnv({ QA_DATABASE_URL: undefined }));
  check(
    'missing database target is refused (no .env fallback)',
    !noDb.ok && /databaseUrl is not set/.test(noDb.reason),
  );
  const nodeEnvOnly = readIsolatedTargets({ ...clean(), NODE_ENV: 'test' });
  check('NODE_ENV=test alone selects nothing', !nodeEnvOnly.ok);
  const ownerBe = readIsolatedTargets(
    withEnv({ QA_BACKEND_URL: 'http://localhost:3001' }),
  );
  check(
    'owner backend URL (:3001) is refused',
    !ownerBe.ok && /owner app \(port 3001\)/.test(ownerBe.reason),
  );
  const ownerFe = readIsolatedTargets(
    withEnv({ QA_FRONTEND_URL: 'http://127.0.0.1:3000' }),
  );
  check(
    'owner frontend URL (:3000) is refused',
    !ownerFe.ok && /owner app \(port 3000\)/.test(ownerFe.reason),
  );
  const owner = ownerEnv();
  const inherited = readIsolatedTargets(
    withEnv({ QA_DATABASE_URL: owner.DATABASE_URL }),
  );
  check(
    'a database URL inherited from .env is refused',
    !inherited.ok && /inherited target refused/.test(inherited.reason),
  );

  console.log('\n== Identity rules (read-only connections)');
  check(
    'protected database name (kltn_db) is refused',
    /protected/.test(
      (await refused(
        withEnv({
          QA_DATABASE_URL:
            'postgresql://harness:harness-disposable@127.0.0.1:5460/kltn_db',
        }),
      )) ?? '',
    ),
  );
  check(
    'protected local port (5432) is refused',
    /protected PostgreSQL container/.test(
      (await refused(
        withEnv({
          QA_DATABASE_URL: owner.DATABASE_URL.replace(
            /\/[^/?]+(\?|$)/,
            '/postgres$1',
          ),
        }),
      )) ?? '',
    ),
  );
  // Reach the protected cluster through the LAN address and another database
  // name: the URL looks harmless, only the cluster identity can refuse it.
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  const disguised = new URL(owner.DATABASE_URL);
  disguised.hostname = lan ?? '';
  disguised.pathname = '/postgres';
  const identity = await refused(
    withEnv({ QA_DATABASE_URL: disguised.toString() }),
  );
  check(
    `protected cluster identity behind a harmless-looking URL is refused (via ${lan})`,
    /protected cluster 7674533776495505443/.test(identity ?? ''),
    identity?.slice(0, 120),
  );
  const sharedRedis = await refused(
    withEnv({ QA_REDIS_URL: 'redis://127.0.0.1:6379' }),
  );
  check(
    'shared Redis (6379) is refused',
    /Redis/.test(sharedRedis ?? ''),
    sharedRedis?.slice(0, 120),
  );
  const missingRedis = readIsolatedTargets(
    withEnv({ QA_REDIS_URL: undefined }),
  );
  check('missing Redis isolation is refused', !missingRedis.ok);
  check(
    'the harness targets are accepted',
    (await refused(withEnv({}))) === null,
  );

  console.log('\n== Scripts stop before any write');
  const harnessBefore = harnessUsers('harness_clone');
  const a = runScript('scripts/qa/global-browser-phase.ts', clean(), ['A']);
  check(
    'global-browser-phase without targets exits at import',
    a.status !== 0 && /QA_TARGET=isolated is required/.test(a.out),
  );
  const b = runScript(
    'scripts/qa/global-browser-phase.ts',
    withEnv({ QA_BACKEND_URL: 'http://localhost:3001' }),
    ['A'],
  );
  check(
    'global-browser-phase with the owner backend exits at import',
    b.status !== 0 && /owner app \(port 3001\)/.test(b.out),
  );
  const fx = runScript(
    'scripts/qa/entry-diagnostic-fixtures.ts',
    withEnv({ QA_REDIS_URL: 'redis://127.0.0.1:6379' }),
  );
  check(
    'entry-diagnostic-fixtures with the shared Redis refuses before creating users',
    fx.status !== 0 && /Redis/.test(fx.out),
  );
  const legacy = runScript('scripts/qa-listening-api.ts', clean(), ['1']);
  check(
    'a pre-CP60 QA script refuses without the owner opt-in',
    legacy.status !== 0 && /QA_LEGACY_SCRIPT_OWNER_APPROVED/.test(legacy.out),
  );
  const ownerSmoke = runScript(
    'scripts/qa/cp59-owner-final-smoke-browser.ts',
    clean(),
  );
  check(
    'the owner read-only smoke refuses without QA_OWNER_READONLY',
    ownerSmoke.status !== 0 && /QA_OWNER_READONLY/.test(ownerSmoke.out),
  );
  const r2 = runScript('scripts/qa/speaking-premium-media-verify.ts', clean());
  check(
    'a real-R2 read refuses without QA_ALLOW_REAL_R2_READ',
    r2.status !== 0 && /QA_ALLOW_REAL_R2_READ/.test(r2.out),
  );
  check(
    'harness_clone gained no user from the refused runs',
    harnessUsers('harness_clone') === harnessBefore,
  );

  console.log('\n== Backend must use the verified database and Redis');
  // cp601_rehearsal is an isolated database in the harness cluster, but the
  // API on :3101 serves harness_clone: the mismatch must be caught after the
  // first learner and that learner removed.
  const mismatchBefore = harnessUsers('cp601_rehearsal');
  const m = runScript(
    'scripts/qa/global-browser-phase.ts',
    withEnv({
      QA_DATABASE_URL:
        'postgresql://harness:harness-disposable@127.0.0.1:5460/cp601_rehearsal',
    }),
    ['A'],
  );
  check(
    'a backend that does not use the verified database is refused',
    m.status !== 0 &&
      /cannot log in a learner created in the verified database/.test(m.out),
    m.out.match(/QA target refused[^\n]*/)?.[0],
  );
  check(
    'and the learner it created there was removed',
    harnessUsers('cp601_rehearsal') === mismatchBefore,
  );

  check(
    'protected User_id_seq unchanged by every check',
    kltnSeq() === seqBefore,
    `(${seqBefore} -> ${kltnSeq()})`,
  );
  console.log(`\nQA_TARGET_GUARD_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
