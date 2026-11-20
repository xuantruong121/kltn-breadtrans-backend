/**
 * SQL against the disposable harness clone only (container harness-pg).
 * Every call first checks the cluster identity and refuses a protected one.
 * `harnessQuery` runs read-only; `harnessExec` may write (clone only), for
 * fixtures such as promoting a harness account to ADMIN.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROTECTED = ['7674533776495505443', '7699757546958700579'];
const psql = (db: string) => [
  'exec',
  'harness-pg',
  'psql',
  '-U',
  'harness',
  '-d',
  db,
  '-tA',
];

/**
 * The database a fixture writes to: HARNESS_DB, else the one the running QA
 * backend uses (written by `finalization-harness.sh qa-backend`), else the
 * shared clone. Without the middle step a script against `qa-backend dev_qa`
 * promoted its admin in harness_clone and every admin call answered 403
 * (owner 2026-11-20). Always a database inside harness-pg.
 */
export function harnessDbName(
  env: NodeJS.ProcessEnv,
  readMarker: (path: string) => string | null,
): string {
  if (env.HARNESS_DB) return env.HARNESS_DB;
  const work =
    env.HARNESS_WORK ?? join(env.TEMP ?? tmpdir(), 'breadtrans-harness');
  const marked = readMarker(join(work, 'qa-backend.db'))?.trim() ?? '';
  return /^[a-z_][a-z0-9_]*$/.test(marked) &&
    !['kltn_db', 'kltn_shadow', 'postgres'].includes(marked)
    ? marked
    : 'harness_clone';
}

const DEFAULT_DB = harnessDbName(process.env, (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
});

export function harnessQuery(sql: string, db = DEFAULT_DB): string[][] {
  return run(sql, true, db);
}

export function harnessExec(sql: string, db = DEFAULT_DB): string[][] {
  return run(sql, false, db);
}

function run(sql: string, readOnly: boolean, db: string): string[][] {
  const PSQL = psql(db);
  const sysid = execFileSync(
    'docker',
    [...PSQL, '-c', 'select system_identifier from pg_control_system()'],
    {
      encoding: 'utf8',
    },
  ).trim();
  if (PROTECTED.includes(sysid))
    throw new Error('REFUSED: harness-pg is a protected cluster');
  const out = execFileSync(
    'docker',
    [
      ...PSQL,
      '-F',
      '\t',
      '-c',
      `set default_transaction_read_only=${readOnly ? 'on' : 'off'}`,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
  return out
    .split('\n')
    .filter(
      (line) =>
        line && line !== 'SET' && !/^(UPDATE|INSERT|DELETE) \d/.test(line),
    )
    .map((line) => line.split('\t'));
}
