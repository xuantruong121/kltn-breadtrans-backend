/**
 * Phase B2B operator runner. One command per invocation, one operator at a time.
 *
 *   import     run the canonical importer once
 *   verify     verify the imported graph field-by-field against the approved content
 *   reimport   re-run the importer and prove nothing was added or rewritten (xmin)
 *   service    real DiagnosticService reads over a READ-ONLY session
 *   negative   attempt-creation and activation must be refused   (REHEARSAL ONLY)
 *
 * Target identity is checked before anything else, on every invocation:
 *
 *   --live       requires database kltn_db, port 5432 and the recorded
 *                system_identifier of the real development cluster
 *   --rehearsal  requires a cluster that is NOT either protected cluster and a
 *                database name that is neither kltn_db nor kltn_shadow
 *
 * A mismatch stops the process before any query that could write.
 *
 * The client is a plain PrismaClient with no PENDING_MIGRATION_OMIT, which is
 * the application's state after B2B removes the omit. `service` and `verify`
 * open their session with default_transaction_read_only=on.
 *
 * Usage:
 *   B2B_TARGET_URL=postgresql://... npx ts-node scripts/audit/b2b-run.ts <cmd> --live|--rehearsal
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { DiagnosticService } from '../../src/modules/diagnostic/diagnostic.service';
import { importApprovedContent } from '../../src/modules/diagnostic/v2-content-importer';
import {
  AUTHORING_ONLY_FIELDS,
  mapObjectiveQuestion,
  mapProductiveTask,
} from '../../src/modules/diagnostic/v2-import-mapper';

const LIVE_SYSID = '7674533776495505443';
const SHADOW_SYSID = '7699757546958700579';
const ARTIFACTS = join(__dirname, '..', '..', 'artifacts');
const SOURCE_KEY = 'DIAG_V2_ASSESSMENT';
const LEGACY_ASSESSMENT_ID = 1;

const [cmd, modeFlag] = process.argv.slice(2);
const mode =
  modeFlag === '--live'
    ? 'live'
    : modeFlag === '--rehearsal'
      ? 'rehearsal'
      : '';
const baseUrl = process.env.B2B_TARGET_URL ?? '';

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
};
const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');

function canonical(v: any): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(',')}}`;
}

function withReadOnly(url: string): string {
  const u = new URL(url);
  u.searchParams.set('options', '-c default_transaction_read_only=on');
  return u.toString();
}

async function guard(prisma: PrismaClient) {
  const u = new URL(baseUrl);
  const [r] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT current_database() AS db,
            (SELECT system_identifier::text FROM pg_control_system()) AS sysid,
            current_setting('server_version') AS ver,
            current_setting('default_transaction_read_only') AS ro`,
  );
  console.log(
    `target ${u.hostname}:${u.port}/${r.db} sysid=${r.sysid} pg=${r.ver} read_only=${r.ro} mode=${mode}`,
  );
  if (mode === 'live') {
    if (r.db !== 'kltn_db' || r.sysid !== LIVE_SYSID || u.port !== '5432') {
      throw new Error(
        'REFUSED: --live target is not the recorded kltn_db cluster',
      );
    }
  } else if (mode === 'rehearsal') {
    if (
      [LIVE_SYSID, SHADOW_SYSID].includes(r.sysid) ||
      ['kltn_db', 'kltn_shadow'].includes(r.db)
    ) {
      throw new Error('REFUSED: --rehearsal target is a protected database');
    }
  } else {
    throw new Error('REFUSED: pass --live or --rehearsal');
  }
  if (!String(r.ver).startsWith('15.'))
    throw new Error('REFUSED: not PostgreSQL 15');
  return r;
}

function loadDraft() {
  const draft = JSON.parse(
    readFileSync(
      join(ARTIFACTS, 'entry-diagnostic-v2-content-draft.json'),
      'utf8',
    ),
  );
  const rubrics = JSON.parse(
    readFileSync(
      join(ARTIFACTS, 'entry-diagnostic-v2-rubrics-draft.json'),
      'utf8',
    ),
  );
  const manifest = new Map<string, string>();
  for (const line of readFileSync(
    join(ARTIFACTS, 'entry-diagnostic-v2-content-draft.sha256'),
    'utf8',
  ).split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    if (m) manifest.set(m[2].trim(), m[1]);
  }
  return { draft, rubrics, manifest };
}

/** Row versions of every row the import owns, plus the legacy rows. */
async function rowVersions(prisma: PrismaClient, assessmentId: number) {
  return prisma.$queryRawUnsafe<any[]>(`
    SELECT 'assessment' AS t, id, xmin::text AS v FROM "DiagnosticAssessment"
     WHERE id IN (${assessmentId}, ${LEGACY_ASSESSMENT_ID})
    UNION ALL SELECT 'question', id, xmin::text FROM "DiagnosticQuestion"
     WHERE "assessmentId" IN (${assessmentId}, ${LEGACY_ASSESSMENT_ID})
    UNION ALL SELECT 'passage', id, xmin::text FROM "DiagnosticReadingPassage"
     WHERE "assessmentId" = ${assessmentId}
    UNION ALL SELECT 'clip', c.id, c.xmin::text FROM "DiagnosticListeningClip" c
      JOIN "DiagnosticQuestion" q ON q.id = c."questionId" WHERE q."assessmentId" = ${assessmentId}
    UNION ALL SELECT 'rubric', id, xmin::text FROM "DiagnosticRubric"
    ORDER BY 1, 2`);
}

async function cmdImport(prisma: PrismaClient) {
  const result = await importApprovedContent(prisma);
  console.log(`IMPORT_RESULT ${JSON.stringify(result)}`);
  ok(
    'importer returned an inactive DRAFT',
    result.isActive === false && result.status === 'DRAFT',
  );
}

async function cmdVerify(prisma: PrismaClient) {
  const { draft, rubrics, manifest } = loadDraft();
  const a = await prisma.diagnosticAssessment.findUnique({
    where: { sourceKey: SOURCE_KEY },
  });
  ok('imported assessment exists', !!a);
  if (!a) return;
  ok(
    'assessment status=DRAFT, isActive=false',
    a.status === 'DRAFT' && a.isActive === false,
    `(id=${a.id} status=${a.status} isActive=${a.isActive})`,
  );
  ok(
    'assessment scoring/blueprint versions match the package',
    a.scoringVersion === draft.scoringVersion &&
      a.blueprintVersion === draft.blueprintVersion,
    `(${a.scoringVersion} / ${a.blueprintVersion})`,
  );

  const questions = await prisma.diagnosticQuestion.findMany({
    where: { assessmentId: a.id },
  });
  const passages = await prisma.diagnosticReadingPassage.findMany({
    where: { assessmentId: a.id },
  });
  const rubricRows = await prisma.diagnosticRubric.findMany();
  const clips = await prisma.diagnosticListeningClip.findMany({
    where: { questionId: { in: questions.map((q) => q.id) } },
  });

  const objective = [
    ...draft.listening.items,
    ...draft.reading.items,
    ...draft.languageUse.items,
  ];
  const productive = [...draft.speaking.tasks, ...draft.writing.tasks];
  const authored = [...objective, ...productive];
  ok('29 question rows', questions.length === 29, `(${questions.length})`);
  ok(
    'question sourceKeys are exactly the 29 authored draftKeys',
    canonical(questions.map((q) => q.sourceKey).sort()) ===
      canonical(authored.map((i: any) => i.draftKey).sort()),
  );
  const sectionCount = (s: string) =>
    questions.filter((q) => (q.options as any)?.section === s).length;
  ok(
    'section counts L10 R10 S2 W2 LU5',
    [
      sectionCount('LISTENING'),
      sectionCount('READING'),
      sectionCount('SPEAKING'),
      sectionCount('WRITING'),
      sectionCount('LANGUAGE_USE'),
    ].join('/') === '10/10/2/2/5',
    `(${['LISTENING', 'READING', 'SPEAKING', 'WRITING', 'LANGUAGE_USE'].map(sectionCount).join('/')})`,
  );

  // Passages: identity, authored text and the approved manifest hash.
  ok('3 passage rows', passages.length === 3, `(${passages.length})`);
  for (const p of draft.reading.passages) {
    const row = passages.find((r) => r.sourceKey === p.draftKey);
    ok(
      `passage ${p.draftKey}: text equals the authored body and the manifest hash`,
      !!row &&
        row.text === p.text &&
        sha256(row.text) === manifest.get(`passage:${p.draftKey}`),
    );
    ok(
      `passage ${p.draftKey}: title deliberately NULL`,
      !!row && row.title === null,
    );
  }

  // Rubrics.
  ok('2 rubric rows', rubricRows.length === 2, `(${rubricRows.length})`);
  for (const r of rubrics.rubrics) {
    const row = rubricRows.find(
      (x) => x.skill === r.skill && x.rubricVersion === r.rubricVersion,
    );
    ok(
      `rubric ${r.skill}/${r.rubricVersion}: criteria equal the approved document`,
      !!row && canonical(row.criteria) === canonical(r.criteria),
    );
  }

  // Every question re-derived by the mapper from ids resolved by identity, and
  // compared column by column with what was stored.
  const ctx = {
    assessmentId: a.id,
    passageIds: Object.fromEntries(passages.map((p) => [p.sourceKey!, p.id])),
    rubricIds: Object.fromEntries(
      rubricRows.map((r) => [r.rubricVersion, r.id]),
    ),
    passageTexts: Object.fromEntries(
      passages.map((p) => [p.sourceKey!, p.text]),
    ),
  };
  let fieldMismatches = 0;
  const mismatchNotes: string[] = [];
  const check = (item: any, payload: any) => {
    const row: any = questions.find((q) => q.sourceKey === item.draftKey);
    if (!row) {
      fieldMismatches += 1;
      mismatchNotes.push(`${item.draftKey}: missing row`);
      return;
    }
    for (const [k, v] of Object.entries(payload)) {
      if (canonical(row[k]) !== canonical(v)) {
        fieldMismatches += 1;
        mismatchNotes.push(`${item.draftKey}.${k}`);
      }
    }
  };
  for (const item of objective) check(item, mapObjectiveQuestion(item, ctx));
  for (const task of productive) check(task, mapProductiveTask(task, ctx));
  ok(
    'every stored column equals the mapper output for its authored item',
    fieldMismatches === 0,
    fieldMismatches ? `(${mismatchNotes.slice(0, 6).join(', ')})` : '(29 rows)',
  );

  // Independent of the mapper: answer key, prompt and options from the raw draft.
  let keyErrors = 0;
  for (const item of objective) {
    const row: any = questions.find((q) => q.sourceKey === item.draftKey);
    const values = row?.options?.values ?? [];
    if (
      row?.question !== item.prompt ||
      canonical(values) !== canonical(item.options) ||
      values[row.correctIndex] !== item.correctAnswer
    )
      keyErrors += 1;
  }
  ok(
    '25 objective rows: prompt, options and answer key equal the raw draft',
    keyErrors === 0,
    `(errors=${keyErrors})`,
  );
  ok(
    '4 productive rows carry correctIndex -1 and no options',
    productive.every((t: any) => {
      const row: any = questions.find((q) => q.sourceKey === t.draftKey);
      return (
        row?.correctIndex === -1 && (row?.options?.values ?? ['x']).length === 0
      );
    }),
  );
  ok(
    'reading questions resolve the passage their item names',
    draft.reading.items.every((i: any) => {
      const row = questions.find((q) => q.sourceKey === i.draftKey);
      const p = passages.find((x) => x.sourceKey === i.passageDraftKey);
      return !!row && !!p && row.passageId === p.id;
    }),
  );
  ok(
    'productive tasks resolve the rubric their item names',
    productive.every((t: any) => {
      const row = questions.find((q) => q.sourceKey === t.draftKey);
      const r = rubricRows.find((x) => x.rubricVersion === t.rubricVersion);
      return !!row && !!r && row.rubricId === r.id;
    }),
  );
  ok(
    'no CEFR level persisted',
    questions.every((q) => q.intendedLevel === null),
  );

  // Listening clip registry.
  ok('10 clip registrations', clips.length === 10, `(${clips.length})`);
  ok(
    'clip scripts hash to exactly 4 authored clips',
    new Set(clips.map((c) => c.scriptSha256)).size === 4,
  );
  let clipErrors = 0;
  for (const item of draft.listening.items) {
    const q = questions.find((x) => x.sourceKey === item.draftKey);
    const c = clips.find((x) => x.questionId === q?.id);
    const authoredClip = draft.listening.clips.find(
      (x: any) => x.draftKey === item.mediaDraftKey,
    );
    if (
      !c ||
      !authoredClip ||
      c.scriptSha256 !== manifest.get(`script:${authoredClip.draftKey}`) ||
      c.script !== authoredClip.script ||
      !c.storageKey.includes(authoredClip.draftKey) ||
      c.url !== '' ||
      c.generationSource !== 'PENDING_PHASE_E' ||
      c.isActive !== false
    )
      clipErrors += 1;
  }
  ok(
    'each Listening question owns one pending clip whose script matches its authored clip and manifest',
    clipErrors === 0,
    `(errors=${clipErrors})`,
  );
  ok(
    'no audio URL invented',
    questions.every((q) => ((q.options as any)?.audioUrl ?? null) === null),
  );

  // Authoring metadata must not have reached the delivered options blob.
  const leakedKeys = new Set<string>();
  for (const q of questions)
    for (const k of Object.keys((q.options as any) ?? {}))
      if ((AUTHORING_ONLY_FIELDS as readonly string[]).includes(k))
        leakedKeys.add(k);
  ok(
    'no authoring-only field name in any options blob',
    leakedKeys.size === 0,
    leakedKeys.size ? `(${[...leakedKeys].join(',')})` : '',
  );
  const labels = draft.reading.passages
    .map((p: any) => p.internalLabel)
    .filter(Boolean);
  const blob =
    JSON.stringify(questions.map((q) => q.options)) + JSON.stringify(passages);
  ok(
    'no authored internalLabel text in stored options or passages',
    labels.every((l: string) => !blob.includes(l)),
    `(labels checked=${labels.length})`,
  );
}

async function cmdReimport(prisma: PrismaClient) {
  const a = await prisma.diagnosticAssessment.findUnique({
    where: { sourceKey: SOURCE_KEY },
  });
  if (!a) throw new Error('no imported assessment to re-import against');
  const counts = async () => {
    const [r] = await prisma.$queryRawUnsafe<any[]>(`
      SELECT (SELECT count(*) FROM "DiagnosticAssessment")::int AS a,
             (SELECT count(*) FROM "DiagnosticQuestion")::int AS q,
             (SELECT count(*) FROM "DiagnosticReadingPassage")::int AS p,
             (SELECT count(*) FROM "DiagnosticListeningClip")::int AS c,
             (SELECT count(*) FROM "DiagnosticRubric")::int AS r`);
    return r;
  };
  const beforeCounts = await counts();
  const before = await rowVersions(prisma, a.id);
  const result = await importApprovedContent(prisma);
  const after = await rowVersions(prisma, a.id);
  const afterCounts = await counts();
  console.log(`REIMPORT_RESULT ${JSON.stringify(result)}`);
  const additional = Object.keys(beforeCounts).reduce(
    (s, k) => s + (afterCounts[k] - beforeCounts[k]),
    0,
  );
  const changedByImporter = Object.values(result.updated).reduce(
    (s: number, n: any) => s + n,
    0,
  );
  const createdByImporter = Object.values(result.created).reduce(
    (s: number, n: any) => s + n,
    0,
  );
  const rewritten = after.filter(
    (r, i) => before[i]?.id !== r.id || before[i]?.v !== r.v,
  );
  ok('ADDITIONAL_ROWS=0', additional === 0, `(${additional})`);
  ok(
    'importer reports 0 created',
    createdByImporter === 0,
    `(${JSON.stringify(result.created)})`,
  );
  ok(
    'CHANGED_ROWS=0 (importer report)',
    changedByImporter === 0,
    `(${JSON.stringify(result.updated)})`,
  );
  ok(
    '0 rows physically rewritten (xmin unchanged)',
    rewritten.length === 0 && before.length === after.length,
    `(rows=${after.length} rewritten=${rewritten.length}${
      rewritten.length
        ? ': ' +
          rewritten
            .slice(0, 5)
            .map((r) => r.t + '#' + r.id)
            .join(',')
        : ''
    })`,
  );
}

async function cmdService(prisma: PrismaClient) {
  const trap = new Proxy(
    {},
    {
      get(_t, p) {
        throw new Error(`GamificationService.${String(p)} was reached`);
      },
    },
  );
  const service = new DiagnosticService(prisma, trap as any);
  const user = await prisma.user.findFirst({
    where: { role: 'STUDENT' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!user) throw new Error('no STUDENT user');
  const draft = await prisma.diagnosticAssessment.findUnique({
    where: { sourceKey: SOURCE_KEY },
  });

  let current: any;
  let err = '';
  try {
    current = await service.getCurrentAssessment(user.id);
  } catch (e: any) {
    err = String(e?.message ?? e)
      .split('\n')
      .pop()!;
  }
  ok(
    'getCurrentAssessment succeeds with the DRAFT present',
    !err,
    err ? `-> ${err}` : '',
  );
  ok(
    'getCurrentAssessment selects the legacy ACTIVE assessment, not the DRAFT',
    current?.id === LEGACY_ASSESSMENT_ID && current?.id !== draft?.id,
    `(served=${current?.id}, draft=${draft?.id})`,
  );
  ok(
    'served form is the 20 legacy questions',
    (current?.questions ?? []).length === 20,
    `(${(current?.questions ?? []).length})`,
  );
  const leak = [
    'correctIndex',
    'explanation',
    'difficulty',
    'intendedLevel',
    'sourceKey',
  ];
  ok(
    'served legacy questions expose no answer or hidden field',
    (current?.questions ?? []).every((q: any) => leak.every((k) => !(k in q))),
  );

  let latest: any;
  let latestErr = '';
  try {
    latest = await service.getLatestResult(user.id);
  } catch (e: any) {
    latestErr = String(e?.message ?? e)
      .split('\n')
      .pop()!;
  }
  ok(
    'getLatestResult succeeds with the DRAFT present',
    !latestErr,
    latestErr ? `-> ${latestErr}` : '',
  );
  ok(
    'getLatestResult returns the legitimate no-result state',
    latest === null,
    `(${JSON.stringify(latest)})`,
  );

  // The DRAFT's own rows through the REAL serializer, for when it is reviewed.
  if (draft) {
    const rows = await prisma.diagnosticQuestion.findMany({
      where: { assessmentId: draft.id },
      orderBy: { order: 'asc' },
    });
    const passages = await prisma.diagnosticReadingPassage.findMany({
      where: { assessmentId: draft.id },
    });
    const serve = (row: any) =>
      (DiagnosticService.prototype as any).sanitizeQuestion.call(
        null,
        row,
        4242,
      );
    const served = rows.map((r) => ({ r, s: serve(r) }));
    const keys = new Set(served.flatMap(({ s }) => Object.keys(s)));
    const forbidden = [
      'correctIndex',
      'explanation',
      'difficulty',
      'intendedLevel',
      'sourceKey',
      'internalLabel',
      'answerRationale',
      'distractorRationales',
      'script',
      'transcript',
    ];
    ok(
      'DRAFT payload: no forbidden key served',
      forbidden.every((k) => !keys.has(k)),
      `(served keys: ${[...keys].sort().join(',')})`,
    );
    const explanations = rows
      .map((r) => r.explanation)
      .filter((e): e is string => !!e && e.length > 25);
    const text = JSON.stringify(served.map(({ s }) => s));
    ok(
      'DRAFT payload: no stored rationale text served',
      explanations.length > 0 && explanations.every((e) => !text.includes(e)),
      `(rationales stored=${explanations.length})`,
    );
    const reading = served.filter(({ s }) => s.section === 'READING');
    ok(
      'DRAFT Reading: every item serves the complete authored passage',
      reading.length === 10 &&
        reading.every(
          ({ r, s }) =>
            s.passageBody?.trim() ===
            passages.find((p) => p.id === r.passageId)?.text.trim(),
        ),
      `(${reading.length} items)`,
    );
    const listening = served.filter(({ s }) => s.section === 'LISTENING');
    ok(
      'DRAFT Listening: audioUrl field present and null, no transcript',
      listening.length === 10 &&
        listening.every(({ s }) => 'audioUrl' in s && s.audioUrl === null),
    );
  }
}

async function cmdNegative(prisma: PrismaClient) {
  if (mode !== 'rehearsal')
    throw new Error(
      'REFUSED: negative tests run on the rehearsal database only',
    );
  const trap = new Proxy(
    {},
    {
      get(_t, p) {
        throw new Error(`GamificationService.${String(p)} was reached`);
      },
    },
  );
  const service = new DiagnosticService(prisma, trap as any);
  const draft = await prisma.diagnosticAssessment.findUnique({
    where: { sourceKey: SOURCE_KEY },
  });
  if (!draft) throw new Error('no DRAFT');
  const user = await prisma.user.findFirst({
    where: { role: 'STUDENT' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const attempts = () => prisma.diagnosticAttempt.count();
  const before = await attempts();

  let startErr: any;
  try {
    await service.startAttempt(user!.id, draft.id);
  } catch (e) {
    startErr = e;
  }
  ok(
    'startAttempt on the DRAFT is refused with NotFoundException',
    startErr?.constructor?.name === 'NotFoundException',
    `(${startErr?.constructor?.name}: ${String(startErr?.message).slice(0, 70)})`,
  );

  let submitErr: any;
  try {
    await service.submitAssessment(
      user!.id,
      draft.id,
      {},
      undefined,
      undefined,
    );
  } catch (e) {
    submitErr = e;
  }
  ok(
    'submitAssessment on the DRAFT is refused with NotFoundException',
    submitErr?.constructor?.name === 'NotFoundException',
    `(${submitErr?.constructor?.name})`,
  );
  ok(
    'no attempt row was created',
    (await attempts()) === before,
    `(before=${before})`,
  );

  // Activation must be impossible at the storage layer while it is a DRAFT.
  let checkErr = '';
  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(
        `UPDATE "DiagnosticAssessment" SET "isActive" = true WHERE id = ${draft.id}`,
      );
      throw new Error('ROLLBACK_SENTINEL');
    });
  } catch (e: any) {
    checkErr = String(e?.message ?? e).replace(/\s+/g, ' ');
  }
  ok(
    'activating the DRAFT is blocked by the status/isActive CHECK',
    /status_matches_isActive|23514/.test(checkErr),
    `-> ${checkErr.slice(0, 80)}`,
  );
  const after = await prisma.diagnosticAssessment.findUnique({
    where: { id: draft.id },
  });
  ok(
    'DRAFT still DRAFT and inactive after the attempt',
    after?.status === 'DRAFT' && after?.isActive === false,
  );
}

async function main() {
  if (!baseUrl) throw new Error('B2B_TARGET_URL is required');
  if (!mode) throw new Error('REFUSED: pass --live or --rehearsal');
  const readOnly = cmd === 'service' || cmd === 'verify';
  const prisma = new PrismaClient({
    datasources: { db: { url: readOnly ? withReadOnly(baseUrl) : baseUrl } },
  });
  const id = await guard(prisma);
  if (readOnly && id.ro !== 'on')
    throw new Error('REFUSED: read-only session not in effect');

  if (cmd === 'import') await cmdImport(prisma);
  else if (cmd === 'verify') await cmdVerify(prisma);
  else if (cmd === 'reimport') await cmdReimport(prisma);
  else if (cmd === 'service') await cmdService(prisma);
  else if (cmd === 'negative') await cmdNegative(prisma);
  else throw new Error(`unknown command ${cmd}`);

  console.log(`\nB2B_${cmd.toUpperCase()}_FAILURES=${failures}`);
  if (process.env.B2B_RESULT_FILE)
    writeFileSync(
      process.env.B2B_RESULT_FILE,
      JSON.stringify({ cmd, mode, failures }),
      'utf8',
    );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(
    'B2B RUN ERROR:',
    String(e?.message ?? e)
      .split('\n')
      .slice(-3)
      .join(' '),
  );
  process.exit(2);
});
