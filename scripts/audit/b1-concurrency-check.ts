/**
 * Phase B1 true-concurrency check.
 *
 * The rehearsal harness runs its concurrency pair AFTER the content is already
 * imported, so both calls take the no-op path and nothing contends. This script
 * forces the real race: two SEPARATE Prisma clients, therefore separate
 * connections, importing into a database that holds no import yet, so both try
 * to create the same assessment, passages, questions and clips at once.
 *
 * It reports which mechanism actually provides the safety rather than asserting
 * one, because "it did not corrupt anything" and "it is protected by X" are
 * different claims.
 *
 * Requires a freshly reset rehearsal database (see b1-reset-rehearsal.sh).
 */
import { PrismaClient } from '@prisma/client';

import { importApprovedContent } from '../../src/modules/diagnostic/v2-content-importer';

const TARGET_URL = process.env.B1_DATABASE_URL ?? '';
const FORBIDDEN_DB = ['kltn_db', 'kltn_shadow'];

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
};

async function main() {
  if (!TARGET_URL) throw new Error('B1_DATABASE_URL is required');
  const dbName = new URL(TARGET_URL).pathname.replace(/^\//, '');
  if (FORBIDDEN_DB.includes(dbName)) {
    throw new Error(`REFUSED: ${dbName} is a protected database`);
  }

  const mk = () =>
    new PrismaClient({ datasources: { db: { url: TARGET_URL } } });
  const a = mk();
  const b = mk();
  const observer = mk();

  const counts = async () => {
    const [r] = await observer.$queryRawUnsafe<any[]>(`
      SELECT (SELECT count(*) FROM "DiagnosticAssessment" WHERE "sourceKey" IS NOT NULL) AS a,
             (SELECT count(*) FROM "DiagnosticQuestion" WHERE "sourceKey" IS NOT NULL) AS q,
             (SELECT count(*) FROM "DiagnosticReadingPassage" WHERE "sourceKey" IS NOT NULL) AS p,
             (SELECT count(*) FROM "DiagnosticListeningClip") AS c,
             (SELECT count(*) FROM "DiagnosticRubric") AS r`);
    return Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, Number(v)]),
    );
  };

  const before = await counts();
  ok(
    'precondition: the database holds no import yet, so the race is real',
    before.a === 0 && before.q === 0,
    JSON.stringify(before),
  );
  if (before.a !== 0) {
    console.log(
      '\nreset the rehearsal database first; aborting without writing',
    );
    process.exit(1);
  }

  // Both clients are started before either is awaited, so the two transactions
  // genuinely overlap on separate connections.
  const pa = importApprovedContent(a);
  const pb = importApprovedContent(b);
  const results = await Promise.allSettled([pa, pb]);

  const after = await counts();
  console.log(`outcomes: ${results.map((r) => r.status).join(' / ')}`);
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === 'rejected') {
      errors.push(String(r.reason?.message ?? r.reason).replace(/\s+/g, ' '));
    }
  }
  for (const e of errors) console.log(`  rejection: ${e.slice(0, 180)}`);

  ok(
    'exactly one assessment exists after the race',
    after.a === 1,
    JSON.stringify(after),
  );
  ok(
    'exactly 29 questions exist after the race',
    after.q === 29,
    `(q=${after.q})`,
  );
  ok(
    'exactly 3 passages exist after the race',
    after.p === 3,
    `(p=${after.p})`,
  );
  ok(
    'exactly 10 clip registrations exist after the race',
    after.c === 10,
    `(c=${after.c})`,
  );
  ok('exactly 2 rubrics exist after the race', after.r === 2, `(r=${after.r})`);

  const [dupes] = await observer.$queryRawUnsafe<any[]>(`
    SELECT (SELECT count(*) FROM (SELECT "assessmentId","sourceKey" FROM "DiagnosticQuestion"
              WHERE "sourceKey" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d) AS dq,
           (SELECT count(*) FROM (SELECT "assessmentId","sourceKey" FROM "DiagnosticReadingPassage"
              WHERE "sourceKey" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d) AS dp,
           (SELECT count(*) FROM (SELECT "questionId",version FROM "DiagnosticListeningClip"
              GROUP BY 1,2 HAVING count(*) > 1) d) AS dc`);
  ok(
    'no duplicate rows of any kind survived the race',
    Number(dupes.dq) === 0 && Number(dupes.dp) === 0 && Number(dupes.dc) === 0,
    `(q=${dupes.dq}, p=${dupes.dp}, clip=${dupes.dc})`,
  );

  // ------------------------------------------------- name the real mechanism
  const text = errors.join(' | ');
  const mechanism = /23505|nique constraint|duplicate key/i.test(text)
    ? 'DATABASE_UNIQUE_CONSTRAINT'
    : /40001|could not serialize/i.test(text)
      ? 'TRANSACTION_ISOLATION_SERIALIZATION_FAILURE'
      : /40P01|deadlock/i.test(text)
        ? 'DATABASE_LOCK_DEADLOCK_ABORT'
        : errors.length === 0
          ? 'NO_CONTENTION_OBSERVED'
          : 'OTHER';
  console.log(`\nCONCURRENCY_SAFETY_MECHANISM=${mechanism}`);
  ok(
    'the mechanism was observed, not assumed',
    mechanism !== 'OTHER',
    `(${mechanism})`,
  );
  if (mechanism === 'NO_CONTENTION_OBSERVED') {
    console.log(
      'NOTE: both imports succeeded with no error. The end state is correct, but\n' +
        '      this run did not demonstrate a constraint, isolation or lock\n' +
        '      actually rejecting a conflicting write. Reported as such.',
    );
  }

  console.log(`\nB1_CONCURRENCY_FAILURES=${failures}`);
  await Promise.all([a.$disconnect(), b.$disconnect(), observer.$disconnect()]);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CHECK ERROR:', e?.message ?? e);
  process.exit(2);
});
