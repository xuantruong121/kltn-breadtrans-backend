/**
 * Phase B1 isolated rehearsal harness.
 *
 * Runs the canonical importer against a DISPOSABLE PostgreSQL 15 database and
 * asserts migration safety, idempotency, rollback, invalid-source rejection,
 * DRAFT invisibility, confidentiality and concurrency.
 *
 * It refuses to run against the real or shadow database. The guard checks the
 * resolved connection string AND the server's own `system_identifier`, because
 * a port or an environment-variable name is not proof of identity.
 *
 * Usage:
 *   B1_DATABASE_URL=postgresql://... B1_FORBIDDEN_SYSTEM_IDS=a,b \
 *     npx ts-node scripts/audit/b1-import-rehearsal.ts
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { importApprovedContent } from '../../src/modules/diagnostic/v2-content-importer';
import { assertNoAuthoringFields } from '../../src/modules/diagnostic/v2-import-mapper';

const TARGET_URL = process.env.B1_DATABASE_URL ?? '';
const FORBIDDEN_DB = ['kltn_db', 'kltn_shadow'];
/** Captured read-only from the protected servers before this run. */
const FORBIDDEN_SYSTEM_IDS = (process.env.B1_FORBIDDEN_SYSTEM_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ARTIFACT_DIR = join(__dirname, '..', '..', 'artifacts');

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
};

/** Copy the approved artifacts to a temp dir and mutate the draft there. */
function fixture(mutate: (draft: any) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'b1-fixture-'));
  cpSync(ARTIFACT_DIR, dir, { recursive: true });
  const f = join(dir, 'entry-diagnostic-v2-content-draft.json');
  const draft = JSON.parse(readFileSync(f, 'utf8'));
  mutate(draft);
  writeFileSync(f, JSON.stringify(draft, null, 2), 'utf8');
  return dir;
}

async function main() {
  // ------------------------------------------------------------------ guard
  if (!TARGET_URL) throw new Error('B1_DATABASE_URL is required');
  const parsed = new URL(TARGET_URL);
  const dbName = parsed.pathname.replace(/^\//, '');
  console.log(
    `target database = ${dbName}   host = ${parsed.hostname}:${parsed.port}`,
  );
  if (FORBIDDEN_DB.includes(dbName)) {
    throw new Error(`REFUSED: ${dbName} is a protected database`);
  }
  if (FORBIDDEN_SYSTEM_IDS.length < 2) {
    throw new Error(
      'B1_FORBIDDEN_SYSTEM_IDS must name both protected clusters',
    );
  }

  const prisma = new PrismaClient({ datasources: { db: { url: TARGET_URL } } });
  const [ident] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT (SELECT system_identifier::text FROM pg_control_system()) AS sid,
            current_database() AS db,
            current_setting('server_version') AS ver`,
  );
  console.log(
    `server_version = ${ident.ver}   system_identifier = ${ident.sid}`,
  );
  if (FORBIDDEN_SYSTEM_IDS.includes(String(ident.sid))) {
    throw new Error('REFUSED: this server is one of the protected clusters');
  }
  ok(
    'isolation: database name is not protected',
    !FORBIDDEN_DB.includes(ident.db),
  );
  ok(
    'isolation: system_identifier differs from both protected clusters',
    !FORBIDDEN_SYSTEM_IDS.includes(String(ident.sid)),
    `(checked against ${FORBIDDEN_SYSTEM_IDS.length} protected ids)`,
  );
  ok('isolation: PostgreSQL 15', String(ident.ver).startsWith('15.'));

  // The harness must REJECT a protected target, not merely avoid one. Prove it
  // by re-invoking this script with kltn_db and requiring a refusal.
  let selfGuard = false;
  let selfOut = '';
  try {
    execSync(`npx ts-node "${__filename}"`, {
      env: {
        ...process.env,
        B1_DATABASE_URL: 'postgresql://u:p@localhost:5432/kltn_db',
      },
      stdio: 'pipe',
    });
  } catch (e: any) {
    selfOut = String(e.stdout ?? '') + String(e.stderr ?? '');
    selfGuard = /REFUSED: kltn_db is a protected database/.test(selfOut);
  }
  ok(
    'guard: harness refuses a protected database target by name',
    selfGuard,
    selfGuard ? '' : `-> ${selfOut.slice(0, 120)}`,
  );

  const snapshot = async () => {
    const [r] = await prisma.$queryRawUnsafe<any[]>(`
      SELECT (SELECT count(*) FROM "DiagnosticAssessment") AS a,
             (SELECT count(*) FROM "DiagnosticQuestion") AS q,
             (SELECT count(*) FROM "DiagnosticReadingPassage") AS p,
             (SELECT count(*) FROM "DiagnosticListeningClip") AS c,
             (SELECT count(*) FROM "DiagnosticRubric") AS r`);
    return Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, Number(v)]),
    );
  };

  const legacyBefore = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, "isActive", status FROM "DiagnosticAssessment"
      WHERE "sourceKey" IS NULL ORDER BY id`,
  );
  const before = await snapshot();
  console.log('before:', JSON.stringify(before));

  // Test B measures what the FIRST import creates, so it needs a database that
  // holds no import yet. Saying so plainly beats letting every Test B count
  // assertion fail with a confusing delta of 0.
  if (before.p !== 0 || before.c !== 0 || before.r !== 0) {
    console.error(
      '\nPRECONDITION FAILED: this database already holds an import ' +
        `(${JSON.stringify(before)}).\n` +
        'Run scripts/audit/b1-reset-rehearsal.sh first.',
    );
    await prisma.$disconnect();
    process.exit(3);
  }

  // ------------------------------------------------------ TEST B: first import
  const first = await importApprovedContent(prisma);
  const afterFirst = await snapshot();
  console.log('after first:', JSON.stringify(afterFirst));
  ok('B: assessment row created', afterFirst.a === before.a + 1);
  ok(
    'B: 29 questions created',
    afterFirst.q === before.q + 29,
    `(+${afterFirst.q - before.q})`,
  );
  ok(
    'B: 3 passages created',
    afterFirst.p === before.p + 3,
    `(+${afterFirst.p - before.p})`,
  );
  ok(
    'B: 10 clip registrations created',
    afterFirst.c === before.c + 10,
    `(+${afterFirst.c - before.c})`,
  );
  ok(
    'B: 2 rubrics created',
    afterFirst.r === before.r + 2,
    `(+${afterFirst.r - before.r})`,
  );
  ok(
    'B: imported as inactive DRAFT',
    first.isActive === false && first.status === 'DRAFT',
  );

  const A = first.assessmentId;

  // ----------------------------------------- reference integrity + clip sharing
  const [refs] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"->>'section' = 'READING'
                AND "passageId" IS NULL) AS reading_no_passage,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"->>'questionType' = 'OPEN_TEXT'
                AND "rubricId" IS NULL) AS productive_no_rubric,
           (SELECT count(DISTINCT "scriptSha256") FROM "DiagnosticListeningClip") AS distinct_scripts,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "intendedLevel" IS NOT NULL) AS cefr_levels,
           (SELECT count(DISTINCT "passageId") FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"->>'section' = 'READING') AS distinct_passages`);
  ok(
    'B: every READING question resolves a passage',
    Number(refs.reading_no_passage) === 0,
  );
  ok(
    'B: every productive task resolves a rubric',
    Number(refs.productive_no_rubric) === 0,
  );
  ok(
    'B: 10 Reading questions span exactly 3 passages',
    Number(refs.distinct_passages) === 3,
  );
  ok(
    'B: 4 distinct scripts across 10 clip rows',
    Number(refs.distinct_scripts) === 4,
    `(distinct=${refs.distinct_scripts})`,
  );
  ok('B: no CEFR level persisted', Number(refs.cefr_levels) === 0);

  // -------------------------------------------- confidentiality in stored rows
  const [leak] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"::text ILIKE '%internalLabel%') AS q_label,
           (SELECT count(*) FROM "DiagnosticReadingPassage"
              WHERE "assessmentId" = ${A} AND "title" IS NOT NULL) AS p_title,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"::text ILIKE '%ationale%') AS q_rationale,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"::text ILIKE '%targetEvidence%') AS q_evidence,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"::text ILIKE '%difficultyTier%') AS q_tier`);
  ok('B: no internalLabel key in stored options', Number(leak.q_label) === 0);
  ok(
    'B: no passage title carries an authoring label',
    Number(leak.p_title) === 0,
  );
  ok('B: no rationale text in stored options', Number(leak.q_rationale) === 0);
  ok('B: no targetEvidence in stored options', Number(leak.q_evidence) === 0);
  ok('B: no difficultyTier in stored options', Number(leak.q_tier) === 0);

  // ---------------------------------------- delivery metadata contract (D4-013)
  const [meta] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"->>'section' = 'LISTENING'
                AND "options" ? 'audioUrl' AND "options" ? 'audioGroup') AS listening_ok,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"->>'section' = 'READING'
                AND length("options"->>'passageText') > 50) AS reading_ok,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"->>'section' = 'SPEAKING'
                AND "prepSeconds" IS NOT NULL AND "responseSeconds" IS NOT NULL) AS speaking_ok,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"->>'section' = 'WRITING'
                AND "wordMin" IS NOT NULL AND "wordMax" IS NOT NULL) AS writing_ok,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A} AND "options"->>'audioUrl' IS NOT NULL) AS fake_audio,
           (SELECT count(*) FROM "DiagnosticQuestion"
              WHERE "assessmentId" = ${A}
                AND jsonb_array_length("options"->'values') = 4) AS four_options`);
  ok(
    'D4-013: all 10 Listening rows carry the audio contract',
    Number(meta.listening_ok) === 10,
  );
  ok(
    'D4-013: all 10 Reading rows carry passage text',
    Number(meta.reading_ok) === 10,
  );
  ok(
    'D4-013: both Speaking rows carry prep/response timing',
    Number(meta.speaking_ok) === 2,
  );
  ok(
    'D4-013: both Writing rows carry word bounds',
    Number(meta.writing_ok) === 2,
  );
  ok(
    'D4-013: no audio URL invented before Phase E',
    Number(meta.fake_audio) === 0,
  );
  ok(
    'D4-013: all 25 objective rows have 4 options',
    Number(meta.four_options) === 25,
    `(four_options=${meta.four_options})`,
  );

  // ----------------------------------------------------- TEST C: second import
  // `DiagnosticQuestion` has no updatedAt column, so an unnecessary rewrite
  // would be invisible to a timestamp check. `xmin` is the row's inserting
  // transaction id: Postgres changes it on every UPDATE, so comparing it
  // proves no row was physically rewritten, which is the stronger claim.
  const rowVersions = async () =>
    prisma.$queryRawUnsafe<any[]>(`
      SELECT 'assessment' AS t, id, xmin::text AS v FROM "DiagnosticAssessment"
        WHERE "sourceKey" IS NOT NULL
      UNION ALL SELECT 'question', id, xmin::text FROM "DiagnosticQuestion"
        WHERE "assessmentId" = ${A}
      UNION ALL SELECT 'passage', id, xmin::text FROM "DiagnosticReadingPassage"
        WHERE "assessmentId" = ${A}
      UNION ALL SELECT 'clip', c.id, c.xmin::text FROM "DiagnosticListeningClip" c
        JOIN "DiagnosticQuestion" q ON q.id = c."questionId" WHERE q."assessmentId" = ${A}
      UNION ALL SELECT 'rubric', id, xmin::text FROM "DiagnosticRubric"
      ORDER BY 1, 2`);
  const tsBefore = await rowVersions();
  const second = await importApprovedContent(prisma);
  const afterSecond = await snapshot();
  const additional = Object.keys(afterFirst).reduce(
    (s, k) => s + (afterSecond[k] - afterFirst[k]),
    0,
  );
  const createdAgain = Object.values(second.created).reduce((s, n) => s + n, 0);
  const changed = Object.values(second.updated).reduce((s, n) => s + n, 0);
  ok('C: ADDITIONAL_ROWS=0', additional === 0, `(additional=${additional})`);
  ok(
    'C: importer created 0 rows on re-import',
    createdAgain === 0,
    `(created=${JSON.stringify(second.created)})`,
  );
  ok(
    'C: EXISTING_ROWS_CHANGED=0',
    changed === 0,
    `(updated=${JSON.stringify(second.updated)})`,
  );
  const tsAfter = await rowVersions();
  const rewritten = tsAfter.filter(
    (r, i) => tsBefore[i]?.v !== r.v || tsBefore[i]?.id !== r.id,
  );
  ok(
    'C: no row physically rewritten by an identical re-import (xmin unchanged)',
    rewritten.length === 0 && tsBefore.length === tsAfter.length,
    `(rows=${tsAfter.length}, rewritten=${rewritten.length}` +
      `${
        rewritten.length
          ? ': ' +
            rewritten
              .slice(0, 5)
              .map((r) => `${r.t}#${r.id}`)
              .join(',')
          : ''
      })`,
  );

  // --------------------------------------------------------- TEST D: rollback
  for (const stage of ['passages', 'questions', 'clips'] as const) {
    const pre = await snapshot();
    let threw = false;
    try {
      await importApprovedContent(prisma, { failAfter: stage });
    } catch {
      threw = true;
    }
    const post = await snapshot();
    ok(`D: injected failure after ${stage} threw`, threw);
    ok(
      `D: counts identical after rollback at ${stage}`,
      JSON.stringify(pre) === JSON.stringify(post),
      JSON.stringify(post),
    );
  }

  // ------------------------------------------ TEST E: invalid source fixtures
  const expectRefusal = async (
    name: string,
    dir: string,
    pattern: RegExp,
    verifyHashes = false,
  ) => {
    const pre = await snapshot();
    let msg = '(no error thrown)';
    let refused = false;
    try {
      await importApprovedContent(prisma, {
        artifactDir: dir,
        verifyHashes,
      });
    } catch (e: any) {
      msg = String(e?.message ?? e)
        .replace(/\s+/g, ' ')
        .slice(0, 110);
      refused = pattern.test(msg);
    }
    const post = await snapshot();
    ok(`E: ${name} refused`, refused, `-> ${msg}`);
    ok(
      `E: ${name} left no rows behind`,
      JSON.stringify(pre) === JSON.stringify(post),
    );
  };

  await expectRefusal(
    'tampered passage text (hash mismatch)',
    fixture((d) => {
      d.reading.passages[0].text = `${d.reading.passages[0].text} Tampered.`;
    }),
    /does not match the approved manifest hash/,
    true,
  );
  // Row counts are blind to this one: two items sharing a draftKey upsert onto
  // the SAME row, so the count stays 29 while one item's content is destroyed.
  // Assert the stored text as well, not just the tally.
  const questionTextBefore = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "sourceKey", question, "correctIndex" FROM "DiagnosticQuestion"
       WHERE "assessmentId" = ${A} ORDER BY "sourceKey"`,
  );
  await expectRefusal(
    'duplicate source keys',
    fixture((d) => {
      d.reading.items[1].draftKey = d.reading.items[0].draftKey;
    }),
    /duplicate question draftKey/,
  );
  const questionTextAfter = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "sourceKey", question, "correctIndex" FROM "DiagnosticQuestion"
       WHERE "assessmentId" = ${A} ORDER BY "sourceKey"`,
  );
  ok(
    'E: duplicate source keys rewrote no row content',
    JSON.stringify(questionTextBefore) === JSON.stringify(questionTextAfter),
  );
  await expectRefusal(
    'missing passage reference',
    fixture((d) => {
      d.reading.items[0].passageDraftKey = 'RDG_P_DOES_NOT_EXIST';
    }),
    /passage/i,
  );
  await expectRefusal(
    'missing clip reference',
    fixture((d) => {
      d.listening.items[0].mediaDraftKey = 'LST_C_DOES_NOT_EXIST';
    }),
    /clip .* unresolved/,
  );
  await expectRefusal(
    'missing rubric reference',
    fixture((d) => {
      d.speaking.tasks[0].rubricVersion = 'does-not-exist';
    }),
    /rubric/i,
  );
  await expectRefusal(
    'invalid answer key',
    fixture((d) => {
      d.reading.items[0].correctAnswer = 'an option that is not in the list';
    }),
    /correctAnswer is not one of options/,
  );
  await expectRefusal(
    'ambiguous answer key (duplicated option)',
    fixture((d) => {
      d.reading.items[0].options[1] = d.reading.items[0].correctAnswer;
    }),
    /correctAnswer is not unique in options/,
  );
  // Forbidden authoring metadata is NOT refused, and claiming otherwise would
  // be a false PASS: the mapper names every column, so an extra draft field is
  // structurally unreachable. The two things that are actually true:
  //   1. such a field is dropped and never persisted, and
  //   2. the allowlist does throw when such a field reaches a payload.
  {
    const pre = await snapshot();
    // Two rules, kept apart on purpose.
    //
    // Fields with NO destination column must reach no row at all. Fields that
    // DO have a designated column (answerRationale -> explanation, result-time
    // only; difficultyTier -> difficulty) are expected in that column, and the
    // claim about them is that they land there and nowhere else. An earlier
    // version of this check asserted "reaches no column" for both groups and
    // reported a FAIL on two deliberate mappings.
    //
    // Every sentinel is a long distinctive token. An earlier version used
    // '%D9%', which matched the V1 fixture's own option text "D9".
    const dir = fixture((d) => {
      d.reading.items[0].internalLabel = 'LEAK_SENTINEL_LABEL_B1';
      d.reading.items[0].targetEvidence = 'LEAK_SENTINEL_EVIDENCE_B1';
      d.reading.items[0].constructRationale = 'LEAK_SENTINEL_CONSTRUCT_B1';
      d.reading.items[0].diagnosticUse = 'LEAK_SENTINEL_USE_B1';
      d.reading.items[0].distractorRationales = {
        x: 'LEAK_SENTINEL_DISTRACTOR_B1',
      };
    });
    let importThrew = '';
    try {
      await importApprovedContent(prisma, {
        artifactDir: dir,
        verifyHashes: false,
      });
    } catch (e: any) {
      importThrew = String(e?.message ?? e).slice(0, 110);
    }
    const post = await snapshot();
    ok(
      'E: authoring metadata on a draft item does not abort the import',
      importThrew === '',
      importThrew ? `-> ${importThrew}` : '',
    );
    ok(
      'E: authoring metadata added no rows',
      JSON.stringify(pre) === JSON.stringify(post),
    );
    for (const sentinel of [
      'LEAK_SENTINEL_LABEL_B1',
      'LEAK_SENTINEL_EVIDENCE_B1',
      'LEAK_SENTINEL_CONSTRUCT_B1',
      'LEAK_SENTINEL_USE_B1',
      'LEAK_SENTINEL_DISTRACTOR_B1',
    ]) {
      const [hit] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*) AS n FROM "DiagnosticQuestion" q
           WHERE q."assessmentId" = ${A} AND to_jsonb(q.*)::text LIKE '%${sentinel}%'`,
      );
      ok(
        `E: ${sentinel} reached no column of any row`,
        Number(hit.n) === 0,
        `(rows=${hit.n})`,
      );
    }

    const [dest] = await prisma.$queryRawUnsafe<any[]>(`
      SELECT (SELECT count(*) FROM "DiagnosticQuestion" WHERE "assessmentId" = ${A}
                AND "options"::text ILIKE '%' || replace(explanation, '%', '') || '%'
                AND explanation IS NOT NULL) AS rationale_in_options,
             (SELECT count(*) FROM "DiagnosticQuestion" WHERE "assessmentId" = ${A}
                AND difficulty IS NOT NULL AND "options"::text LIKE '%' || difficulty || '%') AS tier_in_options,
             (SELECT count(*) FROM "DiagnosticQuestion" WHERE "assessmentId" = ${A}
                AND difficulty IS NOT NULL AND difficulty = "intendedLevel") AS tier_in_cefr,
             (SELECT count(*) FROM "DiagnosticQuestion" WHERE "assessmentId" = ${A}
                AND explanation IS NOT NULL) AS with_explanation,
             (SELECT count(*) FROM "DiagnosticQuestion" WHERE "assessmentId" = ${A}
                AND difficulty IS NOT NULL) AS with_difficulty`);
    ok(
      'E: answerRationale is in explanation only, never in the delivered options blob',
      Number(dest.rationale_in_options) === 0,
      `(rows with explanation=${dest.with_explanation}, also in options=${dest.rationale_in_options})`,
    );
    ok(
      'E: difficultyTier is in difficulty only, never in the delivered options blob',
      Number(dest.tier_in_options) === 0,
      `(rows with difficulty=${dest.with_difficulty}, also in options=${dest.tier_in_options})`,
    );
    ok(
      'E: difficultyTier never reached intendedLevel',
      Number(dest.tier_in_cefr) === 0,
    );

    let guardThrew = '';
    try {
      assertNoAuthoringFields(
        { assessmentId: A, internalLabel: 'leak me' },
        'fixture',
      );
    } catch (e: any) {
      guardThrew = String(e?.message ?? e);
    }
    ok(
      'E: the mapper allowlist throws on an authoring field in a payload',
      /authoring-only field "internalLabel"/.test(guardThrew),
      `-> ${guardThrew.slice(0, 90)}`,
    );
    let colThrew = '';
    try {
      assertNoAuthoringFields(
        { assessmentId: A, difficultyTier: 'D9' },
        'fixture',
      );
    } catch (e: any) {
      colThrew = String(e?.message ?? e);
    }
    ok(
      'E: the mapper allowlist throws on a non-column key',
      /is not a DiagnosticQuestion column/.test(colThrew),
      `-> ${colThrew.slice(0, 90)}`,
    );
  }

  // --------------------------------------------- TEST F: DRAFT invisibility
  const [vis] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT (SELECT id FROM "DiagnosticAssessment" WHERE "isActive" = true
              ORDER BY id DESC LIMIT 1) AS current_id,
           (SELECT count(*) FROM "DiagnosticAssessment" WHERE "isActive" = true) AS active_count,
           (SELECT status FROM "DiagnosticAssessment" WHERE id = ${A}) AS imported_status,
           (SELECT "isActive" FROM "DiagnosticAssessment" WHERE id = ${A}) AS imported_active`);
  ok(
    'F: the active-assessment query still returns the legacy row, not the import',
    Number(vis.current_id) === Number(legacyBefore[0].id),
    `(current=${vis.current_id}, legacy=${legacyBefore[0].id}, imported=${A})`,
  );
  ok('F: exactly one active assessment', Number(vis.active_count) === 1);
  ok(
    'F: imported row is DRAFT and inactive',
    vis.imported_status === 'DRAFT' && vis.imported_active === false,
  );
  const legacyAfter = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, "isActive", status FROM "DiagnosticAssessment"
      WHERE "sourceKey" IS NULL ORDER BY id`,
  );
  ok(
    'F: legacy row unchanged',
    JSON.stringify(legacyBefore) === JSON.stringify(legacyAfter),
  );

  // Two INDEPENDENT database protections exist, and each is blocked by a
  // different write. An earlier version of this test asserted only the unique
  // index and then probed it with a write that trips the CHECK instead, which
  // reported a FAIL even though the database had refused the write correctly.
  const expectBlocked = async (name: string, sql: string, want: RegExp) => {
    let err = '';
    try {
      // Rolled back either way, so a protection that did NOT hold leaves no
      // active DRAFT row behind for the assertions that follow.
      await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(sql);
        throw new Error('ROLLBACK_SENTINEL');
      });
    } catch (e: any) {
      err = String(e?.message ?? e).replace(/\s+/g, ' ');
    }
    const blocked = want.test(err);
    ok(
      `F: ${name}`,
      blocked,
      `-> ${(err.match(want) ? err.match(/constraint "[^"]+"/)?.[0] : err.slice(0, 80)) ?? ''}`,
    );
    return blocked;
  };
  await expectBlocked(
    'the status/isActive CHECK forbids an active DRAFT row',
    `UPDATE "DiagnosticAssessment" SET "isActive" = true WHERE id = ${A}`,
    /DiagnosticAssessment_status_matches_isActive/,
  );
  await expectBlocked(
    'the single-active partial unique index forbids a second ACTIVE row',
    `UPDATE "DiagnosticAssessment" SET "isActive" = true, status = 'ACTIVE' WHERE id = ${A}`,
    // Prisma's raw-query wrapper reports the SQLSTATE but not the index name,
    // so match the code: 23505 is unique_violation. Verified separately in
    // psql, where the name is DiagnosticAssessment_single_active_key.
    /23505/,
  );
  const [stillOne] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT count(*) AS n FROM "DiagnosticAssessment" WHERE "isActive" = true`,
  );
  ok(
    'F: still exactly one active assessment after the attempt',
    Number(stillOne.n) === 1,
  );

  // ------------------------------------------------ TEST G: concurrent import
  const preConc = await snapshot();
  const results = await Promise.allSettled([
    importApprovedContent(prisma as any),
    importApprovedContent(prisma as any),
  ]);
  const postConc = await snapshot();
  const concDelta = Object.keys(preConc).reduce(
    (s, k) => s + (postConc[k] - preConc[k]),
    0,
  );
  ok(
    'G: two concurrent imports produced no extra rows',
    concDelta === 0,
    `(delta=${concDelta}, outcomes=${results.map((r) => r.status).join('/')})`,
  );
  for (const r of results) {
    if (r.status === 'rejected') {
      const m = String(r.reason?.message ?? r.reason)
        .replace(/\s+/g, ' ')
        .slice(0, 140);
      console.log(`      concurrent rejection: ${m}`);
    }
  }
  const [dupes] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT (SELECT count(*) FROM (SELECT "assessmentId","sourceKey" FROM "DiagnosticQuestion"
              WHERE "sourceKey" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d) AS dup_questions,
           (SELECT count(*) FROM (SELECT "assessmentId","sourceKey" FROM "DiagnosticReadingPassage"
              WHERE "sourceKey" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d) AS dup_passages,
           (SELECT count(*) FROM (SELECT "questionId",version FROM "DiagnosticListeningClip"
              GROUP BY 1,2 HAVING count(*) > 1) d) AS dup_clips`);
  ok('G: no duplicate questions', Number(dupes.dup_questions) === 0);
  ok('G: no duplicate passages', Number(dupes.dup_passages) === 0);
  ok('G: no duplicate clip registrations', Number(dupes.dup_clips) === 0);

  const final = await snapshot();
  console.log('final:', JSON.stringify(final));
  console.log(`\nB1_HARNESS_FAILURES=${failures}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e?.message ?? e);
  process.exit(2);
});
