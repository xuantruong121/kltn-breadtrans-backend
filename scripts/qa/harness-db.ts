/**
 * SQL against the disposable harness clone only (container harness-pg).
 * Every call first checks the cluster identity and refuses a protected one.
 * `harnessQuery` runs read-only; `harnessExec` may write (clone only), for
 * fixtures such as promoting a harness account to ADMIN.
 */
import { execFileSync } from 'node:child_process';

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

/** `db` defaults to the shared clone; another database in harness-pg may be named. */
export function harnessQuery(sql: string, db = 'harness_clone'): string[][] {
  return run(sql, true, db);
}

export function harnessExec(sql: string, db = 'harness_clone'): string[][] {
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
