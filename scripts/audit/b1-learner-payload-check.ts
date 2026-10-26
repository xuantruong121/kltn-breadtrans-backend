/**
 * Phase B1 learner-payload check.
 *
 * Reads the imported rows from the DISPOSABLE rehearsal database and runs them
 * through the REAL learner-facing serializer (`DiagnosticService.sanitizeQuestion`)
 * and the real `getQuestionMeta`/`getQuestionOptions`. The point is to test what
 * a learner would actually receive, not to re-assert the mapper's allowlist -
 * an allowlist proves what is written, not what is served.
 *
 * Read-only: it opens no transaction and issues only SELECTs.
 */
import { PrismaClient } from '@prisma/client';

import { DiagnosticService } from '../../src/modules/diagnostic/diagnostic.service';

const TARGET_URL = process.env.B1_DATABASE_URL ?? '';
const FORBIDDEN_DB = ['kltn_db', 'kltn_shadow'];

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
};

/**
 * `sanitizeQuestion` is private and uses no instance state, so it is invoked
 * off the prototype. Calling the real method is the whole point; a local
 * re-implementation would prove nothing about what the API serves.
 */
const sanitize = (row: any, attemptId?: number) =>
  (DiagnosticService.prototype as any).sanitizeQuestion.call(
    null,
    row,
    attemptId,
  );

async function main() {
  if (!TARGET_URL) throw new Error('B1_DATABASE_URL is required');
  const dbName = new URL(TARGET_URL).pathname.replace(/^\//, '');
  if (FORBIDDEN_DB.includes(dbName)) {
    throw new Error(`REFUSED: ${dbName} is a protected database`);
  }
  console.log(`target database = ${dbName} (read-only)`);

  const prisma = new PrismaClient({ datasources: { db: { url: TARGET_URL } } });
  const rows = await prisma.diagnosticQuestion.findMany({
    where: { sourceKey: { not: null } },
    orderBy: { order: 'asc' },
  });
  ok('read 29 imported questions', rows.length === 29, `(rows=${rows.length})`);

  const payloads = rows.map((r) => ({ row: r, out: sanitize(r, 4242) }));
  const served = JSON.stringify(payloads.map((p) => p.out));

  // ------------------------------------------------- confidentiality, served
  const keysServed = new Set<string>();
  for (const p of payloads)
    for (const k of Object.keys(p.out)) keysServed.add(k);
  console.log(`served keys: ${[...keysServed].sort().join(', ')}`);
  for (const forbidden of [
    'correctIndex',
    'explanation',
    'difficulty',
    'intendedLevel',
  ]) {
    ok(
      `confidentiality: "${forbidden}" is not a key of the learner payload`,
      !keysServed.has(forbidden),
    );
  }
  const explanations = rows
    .map((r) => r.explanation)
    .filter((e): e is string => typeof e === 'string' && e.length > 25);
  ok(
    'confidentiality: some rows do carry an explanation, so the next check is meaningful',
    explanations.length > 0,
    `(rows with explanation=${explanations.length})`,
  );
  const leaked = explanations.filter((e) => served.includes(e));
  ok(
    'confidentiality: no stored explanation text appears in the served payload',
    leaked.length === 0,
    `(leaked=${leaked.length})`,
  );
  const tiers = [
    ...new Set(rows.map((r) => r.difficulty).filter(Boolean)),
  ] as string[];
  ok(
    'confidentiality: no difficulty tier value appears in the served payload',
    tiers.every((t) => !new RegExp(`"${t}"`).test(served)),
    `(tiers=${tiers.join(',')})`,
  );

  // --------------------------------------------- answer position is shuffled
  // The key must not be recoverable from option order. Index 0 of the served
  // options must not be the stored key for every row.
  const mcq = payloads.filter((p) => p.out.questionType === 'MCQ');
  const aligned = mcq.filter((p) => {
    const original = (p.row.options as any)?.values ?? [];
    return p.out.options[p.row.correctIndex] === original[p.row.correctIndex];
  });
  ok(
    'delivery: MCQ options are permuted per attempt, not served in authored order',
    aligned.length < mcq.length,
    `(rows whose key stayed in place=${aligned.length}/${mcq.length})`,
  );

  // -------------------------------------------------- LISTENING delivery
  const listening = payloads.filter((p) => p.out.section === 'LISTENING');
  ok(
    'LISTENING: 10 items served',
    listening.length === 10,
    `(${listening.length})`,
  );
  ok(
    'LISTENING: every item carries an audioUrl field',
    listening.every((p) => 'audioUrl' in p.out),
  );
  ok(
    'LISTENING: audioUrl is null before Phase E, not a fabricated path',
    listening.every((p) => p.out.audioUrl === null),
  );

  // ---------------------------------------------------- READING delivery
  const reading = payloads.filter((p) => p.out.section === 'READING');
  ok('READING: 10 items served', reading.length === 10, `(${reading.length})`);
  ok(
    'READING: every item carries passage text',
    reading.every(
      (p) =>
        typeof p.out.passageText === 'string' && p.out.passageText.length > 50,
    ),
  );
  // sanitizeQuestion treats line 1 of passageText as a TITLE when the text has
  // more than one line - a V1 convention where passages were stored
  // "Title\nBody". The imported passages have no title line, so for any
  // multi-paragraph passage the opening paragraph is hoisted into a heading and
  // removed from the body the learner reads.
  const hoisted = reading.filter(
    (p) =>
      p.out.passageTitle &&
      p.out.passageTitle !== 'Đoạn đọc' &&
      !p.out.passageBody.startsWith(p.out.passageTitle),
  );
  ok(
    'READING: no passage has its opening paragraph hoisted into a title',
    hoisted.length === 0,
    hoisted.length
      ? `(${hoisted.length} items; e.g. title="${String(hoisted[0].out.passageTitle).slice(0, 60)}...")`
      : '',
  );
  // Compare against the AUTHORED passage row, not the stored passageText: the
  // stored value carries a title line by design, so comparing the body to it
  // would always look short. The invariant that matters is that the learner
  // receives the whole authored passage.
  const authored = new Map(
    (
      await prisma.diagnosticReadingPassage.findMany({
        where: { sourceKey: { not: null } },
        select: { id: true, text: true },
      })
    ).map((p) => [p.id, p.text]),
  );
  ok(
    'READING: 3 authored passages read back',
    authored.size === 3,
    `(${authored.size})`,
  );
  const incomplete = reading.filter((p) => {
    const want = authored.get(p.row.passageId as number);
    return !want || p.out.passageBody?.trim() !== want.trim();
  });
  ok(
    'READING: the served body is the complete authored passage',
    incomplete.length === 0,
    incomplete.length
      ? `(${incomplete.length} items; first loses ${
          (authored.get(incomplete[0].row.passageId as number)?.length ?? 0) -
          (incomplete[0].out.passageBody?.length ?? 0)
        } chars)`
      : '',
  );
  ok(
    'READING: every item is served under the generic passage heading',
    reading.every((p) => p.out.passageTitle === 'Đoạn đọc'),
    `(distinct titles=${[...new Set(reading.map((p) => p.out.passageTitle))].length})`,
  );

  // ------------------------------------------------- PRODUCTIVE delivery
  const productive = payloads.filter((p) =>
    ['SPEAKING', 'WRITING'].includes(p.out.section),
  );
  ok(
    'PRODUCTIVE: 4 tasks served',
    productive.length === 4,
    `(${productive.length})`,
  );
  ok(
    'PRODUCTIVE: served as OPEN_TEXT with no options',
    productive.every(
      (p) => p.out.questionType === 'OPEN_TEXT' && p.out.options.length === 0,
    ),
  );
  ok(
    'PRODUCTIVE: no correctIndex of -1 is exposed as an answer',
    !/"correctIndex"/.test(JSON.stringify(productive.map((p) => p.out))),
  );

  // ------------------------------------------- LANGUAGE_USE auxiliary items
  const lu = payloads.filter((p) => p.out.section === 'LANGUAGE_USE');
  ok('LANGUAGE_USE: 5 items served', lu.length === 5, `(${lu.length})`);
  ok(
    'LANGUAGE_USE: served with 4 options each',
    lu.every((p) => p.out.options.length === 4),
  );

  console.log(`\nB1_PAYLOAD_FAILURES=${failures}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CHECK ERROR:', e?.message ?? e);
  process.exit(2);
});
