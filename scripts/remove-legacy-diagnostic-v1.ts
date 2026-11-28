/**
 * Remove ONE retired V1 diagnostic assessment (and its questions), with checks.
 *
 * Why a script and not a migration: `prisma migrate deploy` runs on every
 * container start, and every diagnostic relation is ON DELETE CASCADE. A
 * migration that deleted a row would run unseen on any database that has the
 * row, and a wrong id would take attempts and answers with it. This is run by
 * hand, on one database at a time, and does nothing without --apply.
 *
 * Usage (DATABASE_URL picks the database; the name must be stated again):
 *   ts-node scripts/remove-legacy-diagnostic-v1.ts --expect-database kltn_db --expect-questions 20
 *   ts-node scripts/remove-legacy-diagnostic-v1.ts ... --backup-file <dump> --apply --out <json>
 *   ts-node scripts/remove-legacy-diagnostic-v1.ts --expect-database kltn_db --restore-from <json> --apply
 *
 * Options:
 *   --assessment-id N        default 1
 *   --expect-database NAME   required; refused unless current_database() is NAME
 *   --expect-questions N     required; refused unless the assessment has exactly N questions
 *   --backup-file PATH       a pg_dump -Fc file made within the last 60 minutes
 *   --pg-container NAME      container used to read the dump with pg_restore -l (default kltn-postgres)
 *   --out PATH               rollback file written before the delete
 *   --apply                  without it nothing is written (the whole run is a READ ONLY transaction)
 *   --restore-from PATH      put the rows of a rollback file back, with their ids
 *
 * Exit code 0 only when every check passed (and, with --apply, the write committed).
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertDatabaseSafety } from './db-safety-guard';

const RETIRED_VERSION = 'OBJECTIVE_POOLED_V1';
const KEPT_VERSION = 'FOUR_SKILL_PLACEMENT_V2';
const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
const REAL_DATABASE = 'kltn_db';
const REAL_PORT = '5432';

type Tx = Prisma.TransactionClient;
type Check = { name: string; ok: boolean; detail: string };
type RowJson = Record<string, unknown>;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

function die(lines: string[]): never {
  console.error('');
  for (const line of lines) console.error(line);
  console.error('');
  process.exit(1);
}

function target(): { host: string; port: string; database: string } {
  const url = new URL(process.env.DATABASE_URL ?? '');
  return {
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, ''),
  };
}

async function n(tx: Tx, sql: string, ...params: unknown[]): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(sql, ...params);
  return Number(rows[0].n);
}

/** Every foreign key that points at the two tables, with how many rows use the targets. */
async function dependents(tx: Tx, assessmentId: number, questionIds: number[]) {
  const fks = await tx.$queryRawUnsafe<
    Array<{ tbl: string; col: string; ref: string; cols: number }>
  >(`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col,
           c.confrelid::regclass::text AS ref, array_length(c.conkey, 1) AS cols
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid IN ('"DiagnosticAssessment"'::regclass, '"DiagnosticQuestion"'::regclass)
  `);
  const result: Array<{
    table: string;
    column: string;
    rows: number;
    single: boolean;
  }> = [];
  for (const fk of fks) {
    const isAssessmentRef = fk.ref === '"DiagnosticAssessment"';
    const ids = isAssessmentRef ? [assessmentId] : questionIds;
    const rows = ids.length
      ? await n(
          tx,
          `SELECT count(*) AS n FROM ${fk.tbl} WHERE "${fk.col}" = ANY($1::int[])`,
          ids,
        )
      : 0;
    result.push({
      table: fk.tbl,
      column: fk.col,
      rows,
      single: Number(fk.cols) === 1,
    });
  }
  return result;
}

function backupChecks(
  backupFile: string | undefined,
  container: string,
): Check[] {
  if (!backupFile)
    return [
      { name: 'backup file', ok: false, detail: 'NOT_RUN: pass --backup-file' },
    ];
  let stat;
  try {
    stat = statSync(backupFile);
  } catch {
    return [
      { name: 'backup file', ok: false, detail: `missing: ${backupFile}` },
    ];
  }
  const ageMin = (Date.now() - stat.mtimeMs) / 60000;
  const checks: Check[] = [
    {
      name: 'backup is recent',
      ok: Date.now() - stat.mtimeMs <= BACKUP_MAX_AGE_MS && stat.size > 0,
      detail: `${ageMin.toFixed(1)} min old, ${stat.size} bytes (limit 60 min)`,
    },
  ];
  const listed = spawnSync(
    'docker',
    ['exec', '-i', container, 'pg_restore', '-l'],
    {
      input: readFileSync(backupFile),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const text = listed.stdout?.toString() ?? '';
  checks.push({
    name: 'backup is readable by pg_restore and holds the diagnostic tables',
    ok:
      listed.status === 0 &&
      /TABLE DATA public DiagnosticAssessment /.test(text) &&
      /TABLE DATA public DiagnosticQuestion /.test(text),
    detail: `pg_restore -l exit ${listed.status}, ${text.split('\n').length} lines`,
  });
  return checks;
}

function print(title: string, checks: Check[]) {
  console.log(`\n${title}`);
  for (const c of checks)
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
}

async function snapshot(tx: Tx, keptId: number) {
  return {
    assessments: await n(
      tx,
      'SELECT count(*) AS n FROM "DiagnosticAssessment"',
    ),
    keptQuestions: await n(
      tx,
      'SELECT count(*) AS n FROM "DiagnosticQuestion" WHERE "assessmentId" = $1',
      keptId,
    ),
    attempts: await n(tx, 'SELECT count(*) AS n FROM "DiagnosticAttempt"'),
    skillResults: await n(
      tx,
      'SELECT count(*) AS n FROM "DiagnosticSkillResult"',
    ),
    learnerProfilesWithPlacement: await n(
      tx,
      'SELECT count(*) AS n FROM "LearnerProfile" WHERE "placementAttemptId" IS NOT NULL',
    ),
  };
}

async function removeRun(prisma: PrismaClient) {
  const assessmentId = Number(arg('--assessment-id') ?? 1);
  const expectQuestions = Number(arg('--expect-questions'));
  if (!Number.isInteger(expectQuestions) || expectQuestions <= 0)
    die(['--expect-questions N is required (the number the dry run showed).']);
  const apply = flag('--apply');
  const backupFile = arg('--backup-file');
  const out =
    arg('--out') ??
    'D:\\Study\\KLTN\\artifacts\\diagnostic-v1-removal\\da-xoa.json';
  const container = arg('--pg-container') ?? 'kltn-postgres';

  console.log(
    `mode: ${apply ? 'APPLY' : 'DRY RUN (read only)'}  assessment id: ${assessmentId}`,
  );
  const backup = backupChecks(backupFile, container);

  // Phase 1: read everything inside a READ ONLY transaction.
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [assessment] = await tx.$queryRawUnsafe<RowJson[]>(
      'SELECT to_jsonb(a) AS row FROM "DiagnosticAssessment" a WHERE a.id = $1',
      assessmentId,
    );
    const row = (assessment?.row ?? null) as RowJson | null;
    const questions = (
      await tx.$queryRawUnsafe<Array<{ row: RowJson }>>(
        'SELECT to_jsonb(q) AS row FROM "DiagnosticQuestion" q WHERE q."assessmentId" = $1 ORDER BY q.id',
        assessmentId,
      )
    ).map((r) => r.row);
    const questionIds = questions.map((q) => Number(q.id));
    const kept = await tx.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "DiagnosticAssessment" WHERE "isActive" = true AND "scoringVersion" = $1`,
      KEPT_VERSION,
    );
    const activeOther = await n(
      tx,
      `SELECT count(*) AS n FROM "DiagnosticAssessment" WHERE "isActive" = true AND id <> $1`,
      assessmentId,
    );
    const deps = await dependents(tx, assessmentId, questionIds);
    const before = kept.length === 1 ? await snapshot(tx, kept[0].id) : null;
    return { row, questions, kept, activeOther, deps, before };
  });

  const checks: Check[] = [
    {
      name: 'assessment exists',
      ok: plan.row !== null,
      detail: plan.row
        ? `id ${assessmentId}, title ${JSON.stringify(plan.row.title)}`
        : 'not found',
    },
    {
      name: `assessment is the retired version ${RETIRED_VERSION}`,
      ok: plan.row?.scoringVersion === RETIRED_VERSION,
      detail: `scoringVersion = ${JSON.stringify(plan.row?.scoringVersion)}`,
    },
    {
      name: 'assessment is not active',
      ok: plan.row?.isActive === false && plan.row?.status !== 'ACTIVE',
      detail: `isActive = ${JSON.stringify(plan.row?.isActive)}, status = ${JSON.stringify(plan.row?.status)}`,
    },
    {
      name: `question count equals --expect-questions ${expectQuestions}`,
      ok: plan.questions.length === expectQuestions,
      detail: `${plan.questions.length} questions`,
    },
    {
      name: `exactly one active ${KEPT_VERSION} assessment, and no other active one`,
      ok: plan.kept.length === 1 && plan.activeOther === 1,
      detail: `active ${KEPT_VERSION}: ${plan.kept.map((k) => k.id).join(',') || 'none'}; active other than target: ${plan.activeOther}`,
    },
  ];
  for (const dep of plan.deps) {
    const isQuestions =
      dep.table === '"DiagnosticQuestion"' && dep.column === 'assessmentId';
    checks.push({
      name: isQuestions
        ? 'questions of the assessment (these are deleted with it)'
        : `no ${dep.table}.${dep.column} row depends on the target`,
      ok:
        dep.single &&
        (isQuestions ? dep.rows === expectQuestions : dep.rows === 0),
      detail: `${dep.rows} row(s)${dep.single ? '' : ' (composite key, not handled)'}`,
    });
  }
  const allChecks = [...checks, ...backup];
  print('Checks', allChecks);
  console.log('\nWould delete:');
  console.log(`  DiagnosticQuestion  ${plan.questions.length} row(s)`);
  console.log(`  DiagnosticAssessment 1 row (id ${assessmentId})`);
  if (plan.before)
    console.log('Kept (must not change):', JSON.stringify(plan.before));

  const ready = allChecks.every((c) => c.ok);
  if (!apply) {
    console.log(
      ready
        ? '\nDRY RUN: every check passed. Nothing was written.'
        : '\nDRY RUN: a check failed. Nothing was written and --apply would refuse.',
    );
    return ready ? 0 : 1;
  }
  if (!ready) die(['APPLY REFUSED: a check failed. Nothing was written.']);
  if (!plan.before || !plan.row) die(['APPLY REFUSED: no snapshot.']);

  // Rollback file first: if this write fails, nothing was deleted; if the delete
  // later turns out to be wrong, --restore-from puts these rows back.
  const dump = backupFile ? readFileSync(backupFile) : Buffer.alloc(0);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        target: target(),
        note: 'Rows removed by remove-legacy-diagnostic-v1.ts. Restore with --restore-from.',
        backup: backupFile
          ? {
              file: backupFile,
              bytes: dump.length,
              sha256: createHash('sha256').update(dump).digest('hex'),
            }
          : null,
        keptBefore: plan.before,
        assessment: plan.row,
        questions: plan.questions,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nRollback file written: ${out}`);

  // Phase 2: one transaction; anything unexpected throws and rolls everything back.
  const keptId = plan.kept[0].id;
  const after = await prisma.$transaction(async (tx) => {
    const questions = await tx.$executeRawUnsafe(
      'DELETE FROM "DiagnosticQuestion" WHERE "assessmentId" = $1',
      assessmentId,
    );
    if (questions !== expectQuestions)
      throw new Error(
        `deleted ${questions} questions, expected ${expectQuestions}`,
      );
    const assessments = await tx.$executeRawUnsafe(
      `DELETE FROM "DiagnosticAssessment" WHERE id = $1 AND "scoringVersion" = $2 AND "isActive" = false`,
      assessmentId,
      RETIRED_VERSION,
    );
    if (assessments !== 1)
      throw new Error(`deleted ${assessments} assessments, expected 1`);
    const snap = await snapshot(tx, keptId);
    const want = { ...plan.before!, assessments: plan.before!.assessments - 1 };
    if (JSON.stringify(snap) !== JSON.stringify(want))
      throw new Error(
        `kept data changed: ${JSON.stringify(snap)} vs ${JSON.stringify(want)}`,
      );
    return snap;
  });
  console.log('APPLIED. After:', JSON.stringify(after));
  return 0;
}

async function restoreRun(prisma: PrismaClient, file: string) {
  const apply = flag('--apply');
  const saved = JSON.parse(readFileSync(file, 'utf8')) as {
    assessment: RowJson;
    questions: RowJson[];
  };
  const assessmentId = Number(saved.assessment.id);
  const questionIds = saved.questions.map((q) => Number(q.id));
  console.log(
    `mode: ${apply ? 'APPLY' : 'DRY RUN (read only)'}  restore assessment ${assessmentId} with ${questionIds.length} question(s) from ${file}`,
  );

  const state = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return {
      assessmentPresent: await n(
        tx,
        'SELECT count(*) AS n FROM "DiagnosticAssessment" WHERE id = $1',
        assessmentId,
      ),
      questionsPresent: await n(
        tx,
        'SELECT count(*) AS n FROM "DiagnosticQuestion" WHERE id = ANY($1::int[])',
        questionIds,
      ),
    };
  });
  const checks: Check[] = [
    {
      name: 'assessment id is free',
      ok: state.assessmentPresent === 0,
      detail: `${state.assessmentPresent} row(s) with that id`,
    },
    {
      name: 'question ids are free',
      ok: state.questionsPresent === 0,
      detail: `${state.questionsPresent} row(s) with those ids`,
    },
    {
      name: 'rollback file has rows',
      ok: questionIds.length > 0,
      detail: `${questionIds.length} question(s)`,
    },
  ];
  print('Checks', checks);
  if (!apply) {
    console.log(
      checks.every((c) => c.ok)
        ? '\nDRY RUN: restore would proceed. Nothing was written.'
        : '\nDRY RUN: restore would refuse.',
    );
    return checks.every((c) => c.ok) ? 0 : 1;
  }
  if (!checks.every((c) => c.ok))
    die(['RESTORE REFUSED: a check failed. Nothing was written.']);
  await prisma.$transaction(async (tx) => {
    const a = await tx.$executeRawUnsafe(
      'INSERT INTO "DiagnosticAssessment" SELECT * FROM jsonb_populate_record(NULL::"DiagnosticAssessment", $1::jsonb)',
      JSON.stringify(saved.assessment),
    );
    if (a !== 1) throw new Error(`restored ${a} assessments, expected 1`);
    let q = 0;
    for (const question of saved.questions)
      q += await tx.$executeRawUnsafe(
        'INSERT INTO "DiagnosticQuestion" SELECT * FROM jsonb_populate_record(NULL::"DiagnosticQuestion", $1::jsonb)',
        JSON.stringify(question),
      );
    if (q !== questionIds.length)
      throw new Error(
        `restored ${q} questions, expected ${questionIds.length}`,
      );
  });
  console.log(
    `RESTORED assessment ${assessmentId} and ${questionIds.length} question(s).`,
  );
  return 0;
}

async function main() {
  const expectDatabase = arg('--expect-database');
  if (!expectDatabase) die(['--expect-database NAME is required.']);
  const t = target();
  console.log(`target: ${t.host}:${t.port} / ${t.database}`);
  if (t.database !== expectDatabase)
    die([
      `REFUSED: DATABASE_URL is "${t.database}", --expect-database says "${expectDatabase}".`,
    ]);
  const isReal = t.database === REAL_DATABASE;
  if (!isReal && t.port === REAL_PORT)
    die([
      'REFUSED: a database other than kltn_db on the real cluster port. Use a disposable cluster.',
    ]);
  if (isReal) assertDatabaseSafety(process.argv.slice(2));

  const prisma = new PrismaClient();
  try {
    const [{ database }] = await prisma.$queryRawUnsafe<
      Array<{ database: string }>
    >('SELECT current_database() AS database');
    if (database !== expectDatabase)
      die([
        `REFUSED: connected to "${database}", expected "${expectDatabase}".`,
      ]);
    const restoreFrom = arg('--restore-from');
    const code = restoreFrom
      ? await restoreRun(prisma, restoreFrom)
      : await removeRun(prisma);
    process.exitCode = code;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    'FAILED, transaction rolled back:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
