/**
 * Phase C1 isolated runtime test.
 *
 * Drives the REAL DiagnosticService against a disposable PostgreSQL 15 clone
 * (checkpoint restore + migration + import). Every path that writes - start,
 * submit, replay, concurrent duplicate, DRAFT start/submit - runs here and
 * never against kltn_db or kltn_shadow.
 *
 * The target's cluster identity is checked before the first query that could
 * write, and the protected clusters are refused.
 *
 * Usage:
 *   C1_TARGET_URL=postgresql://... npx ts-node scripts/audit/c1-isolated-runtime.ts
 */
import { PrismaClient } from '@prisma/client';

import {
  evaluateAssessmentReadiness,
  LEARNER_PERMUTATION_SCHEME,
} from '../../src/modules/diagnostic/diagnostic.logic';
import { DiagnosticService } from '../../src/modules/diagnostic/diagnostic.service';

const PROTECTED = ['7674533776495505443', '7699757546958700579'];
const url = process.env.C1_TARGET_URL ?? '';

let failures = 0;
const results: Array<{ name: string; pass: boolean; detail: string }> = [];
const ok = (name: string, cond: boolean, detail = '') => {
  results.push({ name, pass: cond, detail });
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
};
const errName = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (e: any) {
    return e?.constructor?.name ?? 'Error';
  }
};

async function main() {
  if (!url) throw new Error('C1_TARGET_URL is required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const [id] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT current_database() AS db,
            (SELECT system_identifier::text FROM pg_control_system()) AS sysid`,
  );
  console.log(`target ${new URL(url).port}/${id.db} sysid=${id.sysid}`);
  if (
    PROTECTED.includes(id.sysid) ||
    ['kltn_db', 'kltn_shadow'].includes(id.db)
  ) {
    throw new Error('REFUSED: protected database');
  }

  const rewards: unknown[] = [];
  const gamification = {
    awardBanh: (...args: unknown[]) => {
      rewards.push(args);
      return Promise.resolve({ granted: 50 });
    },
  };
  const service = new DiagnosticService(prisma, gamification as any);

  const students = await prisma.user.findMany({
    where: { role: 'STUDENT' },
    orderBy: { id: 'asc' },
    select: { id: true },
    take: 2,
  });
  if (students.length < 2) throw new Error('need two STUDENT users');
  const [u, other] = [students[0].id, students[1].id];
  const legacy = await prisma.diagnosticQuestion.findMany({
    where: { assessmentId: 1 },
    orderBy: { order: 'asc' },
  });
  const keyText = new Map(
    legacy.map((q) => [q.id, (q.options as string[])[q.correctIndex]]),
  );
  const wrongText = new Map(
    legacy.map((q) => [
      q.id,
      (q.options as string[]).find((_, i) => i !== q.correctIndex)!,
    ]),
  );
  const counts = async () => ({
    attempts: await prisma.diagnosticAttempt.count(),
    activities: await prisma.learningActivity.count({
      where: { type: 'DIAGNOSTIC' },
    }),
  });

  // ------------------------------------------------- selection and order
  const served0: any = await service.getCurrentAssessment(u);
  ok(
    'getCurrentAssessment selects the ACTIVE assessment id=1, not the DRAFT id=5',
    served0.id === 1,
    `(served=${served0.id})`,
  );
  const start: any = await service.startAttempt(u, 1);
  ok(
    'startAttempt creates an IN_PROGRESS attempt',
    start.status === 'IN_PROGRESS',
    `(attempt=${start.attemptId})`,
  );
  const served1: any = await service.getCurrentAssessment(u);
  const orders = (s: any) =>
    JSON.stringify(s.questions.map((q: any) => q.options));
  ok(
    'ROOT DEFECT CLOSED: the option order is identical before and after start',
    orders(served0) === orders(served1),
  );
  const moved = served0.questions.filter(
    (q: any, i: number) =>
      q.options.join('|') !== (legacy[i].options as string[]).join('|'),
  ).length;
  ok(
    'the served order really is permuted (not authored order)',
    moved > 0,
    `(${moved}/20 items reordered)`,
  );

  // 13 correct, 7 wrong, chosen by text and clicked by displayed index.
  const click = (served: any, qid: number, text: string) =>
    served.questions.find((q: any) => q.id === qid).options.indexOf(text);
  const answers: Record<string, number> = {};
  const expectCorrect = new Map<number, boolean>();
  legacy.forEach((q, i) => {
    const right = i < 13;
    expectCorrect.set(q.id, right);
    answers[String(q.id)] = click(
      served1,
      q.id,
      right ? keyText.get(q.id)! : wrongText.get(q.id)!,
    );
  });

  // ------------------------------------------------- negative submissions
  const before = await counts();
  ok(
    'submit with no attempt id is refused',
    (await errName(() => service.submitAssessment(u, 1, answers))) ===
      'BadRequestException',
  );
  const otherStart: any = await service.startAttempt(other, 1);
  ok(
    "submit with another learner's attempt is refused",
    (await errName(() =>
      service.submitAssessment(u, 1, answers, undefined, otherStart.attemptId),
    )) === 'BadRequestException',
  );
  ok(
    'submit against the DRAFT assessment is refused',
    (await errName(() =>
      service.submitAssessment(u, 5, answers, undefined, start.attemptId),
    )) === 'NotFoundException',
  );
  ok(
    'submit with an out-of-range option index is refused',
    (await errName(() =>
      service.submitAssessment(
        u,
        1,
        { ...answers, [String(legacy[0].id)]: 9 },
        undefined,
        start.attemptId,
      ),
    )) === 'BadRequestException',
  );
  ok(
    'submit with a non-existent attempt is refused',
    (await errName(() =>
      service.submitAssessment(u, 1, answers, undefined, 999999),
    )) === 'BadRequestException',
  );
  const afterNeg = await counts();
  ok(
    'refused submissions wrote nothing',
    afterNeg.attempts === before.attempts + 1 &&
      afterNeg.activities === before.activities,
    `(attempts ${before.attempts}->${afterNeg.attempts}: +1 is the other learner's start)`,
  );

  // ---------------------------------------------- the real submission
  const result: any = await service.submitAssessment(
    u,
    1,
    answers,
    undefined,
    start.attemptId,
  );
  const row = await prisma.diagnosticAttempt.findUnique({
    where: { id: start.attemptId },
  });
  ok(
    'persisted grade equals the options the learner actually clicked: 13/20',
    row?.correctCount === 13 &&
      row?.totalCount === 20 &&
      row?.status === 'COMPLETED',
    `(stored ${row?.correctCount}/${row?.totalCount} ${row?.status})`,
  );
  ok(
    'persisted answers record the permutation scheme',
    (row?.answers as any)?.__permScheme === LEARNER_PERMUTATION_SCHEME,
  );
  const perItem = result.questionsResult.filter(
    (r: any) => r.isCorrect !== expectCorrect.get(r.questionId),
  );
  ok(
    'every per-question verdict matches the intended answer',
    perItem.length === 0,
    `(mismatches=${perItem.length})`,
  );
  ok(
    'selectedText shows the option the learner clicked',
    result.questionsResult.every(
      (r: any) =>
        r.selectedText ===
        (expectCorrect.get(r.questionId) ? keyText : wrongText).get(
          r.questionId,
        ),
    ),
  );
  const latest: any = await service.getLatestResult(u);
  ok(
    'getLatestResult reproduces the stored grade',
    latest?.correctCount === 13,
    `(${latest?.correctCount})`,
  );

  // ------------------------------------------------- replay and retake
  const xmin = async () =>
    (
      await prisma.$queryRawUnsafe<any[]>(
        `SELECT xmin::text AS v FROM "DiagnosticAttempt" WHERE id = ${start.attemptId}`,
      )
    )[0].v;
  const xminBefore = await xmin();
  const allRight: Record<string, number> = {};
  for (const q of legacy)
    allRight[String(q.id)] = click(served1, q.id, keyText.get(q.id)!);
  const activitiesBefore = (await counts()).activities;
  const replay: any = await service.submitAssessment(
    u,
    1,
    allRight,
    undefined,
    start.attemptId,
  );
  ok(
    'a replayed all-correct submission does not change the grade',
    replay.correctCount === 13,
    `(${replay.correctCount})`,
  );
  ok(
    'the replay rewrote nothing (attempt xmin unchanged, no new activity)',
    (await xmin()) === xminBefore &&
      (await counts()).activities === activitiesBefore,
  );
  const retake: any = await service.startAttempt(u, 1);
  ok(
    'startAttempt after completion returns the completed attempt, no retake',
    retake.status === 'COMPLETED' && retake.attemptId === start.attemptId,
  );

  // ---------------------------------------- concurrent duplicate submits
  const otherAnswers: Record<string, number> = {};
  const servedOther: any = await service.getCurrentAssessment(other);
  for (const q of legacy)
    otherAnswers[String(q.id)] = click(servedOther, q.id, keyText.get(q.id)!);
  const rewardsBefore = rewards.length;
  const activitiesBeforeRace = (await counts()).activities;
  const race = await Promise.allSettled([
    service.submitAssessment(
      other,
      1,
      otherAnswers,
      undefined,
      otherStart.attemptId,
    ),
    service.submitAssessment(
      other,
      1,
      otherAnswers,
      undefined,
      otherStart.attemptId,
    ),
  ]);
  const raced = await prisma.diagnosticAttempt.findUnique({
    where: { id: otherStart.attemptId },
  });
  ok(
    'two concurrent submits of one attempt complete it exactly once',
    raced?.status === 'COMPLETED' &&
      raced?.correctCount === 20 &&
      (await counts()).activities === activitiesBeforeRace + 1,
    `(outcomes=${race.map((r) => r.status).join('/')}, activities +${(await counts()).activities - activitiesBeforeRace})`,
  );
  ok(
    'the first-completion reward was granted at most once',
    rewards.length - rewardsBefore <= 1,
    `(+${rewards.length - rewardsBefore})`,
  );

  // ------------------------------------------------------------- DRAFT
  const draftAttemptsBefore = await prisma.diagnosticAttempt.count({
    where: { assessmentId: 5 },
  });
  ok(
    'startAttempt on the DRAFT is refused',
    (await errName(() => service.startAttempt(u, 5))) === 'NotFoundException',
  );
  ok(
    'submitAssessment on the DRAFT is refused',
    (await errName(() =>
      service.submitAssessment(other, 5, {}, undefined, otherStart.attemptId),
    )) === 'NotFoundException',
  );
  ok(
    'no attempt exists on the DRAFT',
    (await prisma.diagnosticAttempt.count({ where: { assessmentId: 5 } })) ===
      draftAttemptsBefore && draftAttemptsBefore === 0,
  );
  const servedAfter: any = await service.getCurrentAssessment(u);
  ok(
    'the ACTIVE assessment is still the one served after all of the above',
    servedAfter.id === 1,
  );
  const lifecycle = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, status::text AS status, "isActive" FROM "DiagnosticAssessment" ORDER BY id`,
  );
  ok(
    'lifecycle unchanged: id=1 ACTIVE, id=5 DRAFT inactive',
    JSON.stringify(lifecycle) ===
      JSON.stringify([
        { id: 1, status: 'ACTIVE', isActive: true },
        { id: 5, status: 'DRAFT', isActive: false },
      ]),
  );

  // -------------------------------------------------- readiness layers
  const draft = await prisma.diagnosticAssessment.findUnique({
    where: { id: 5 },
    include: { questions: true },
  });
  const report = evaluateAssessmentReadiness(draft!, draft!.questions);
  console.log(
    `DRAFT readiness ${JSON.stringify({
      content: report.content,
      runtime: {
        ready: report.runtime.ready,
        defects: report.runtime.defects.length,
      },
      activation: report.activation,
    })}`,
  );
  ok(
    'DRAFT content is structurally valid under task-type rules',
    report.content.valid,
    report.content.defects.join('; '),
  );
  ok(
    'DRAFT runtime is NOT ready: exactly the 10 Listening items lack audio',
    !report.runtime.ready &&
      report.runtime.defects.length === 10 &&
      report.runtime.defects.every((d) =>
        d.startsWith('missing listening audio'),
      ),
  );
  ok(
    'DRAFT activation is blocked by runtime AND by the unimplemented scorer',
    !report.activation.ready &&
      report.activation.blockers.some((b) => b.startsWith('runtime')) &&
      report.activation.blockers.some((b) => /FOUR_SKILL_PLACEMENT_V2/.test(b)),
  );
  const active = await prisma.diagnosticAssessment.findUnique({
    where: { id: 1 },
    include: { questions: true },
  });
  const activeReport = evaluateAssessmentReadiness(active!, active!.questions);
  ok(
    'the ACTIVE legacy assessment passes all three layers',
    activeReport.content.valid &&
      activeReport.runtime.ready &&
      activeReport.activation.ready,
    activeReport.activation.blockers.join('; '),
  );

  // --------------------------------------- DRAFT delivery through the serializer
  const serve = (q: any) =>
    (DiagnosticService.prototype as any).sanitizeQuestion.call(
      DiagnosticService.prototype,
      q,
      undefined,
    );
  const out = draft!.questions.map((q) => ({ q, s: serve(q) }));
  const sp = out.filter(({ s }) => s.taskType === 'SPEAKING_RESPONSE');
  const wr = out.filter(({ s }) => s.taskType === 'WRITING_RESPONSE');
  const ls = out.filter(({ s }) => s.section === 'LISTENING');
  const rd = out.filter(({ s }) => s.section === 'READING');
  ok(
    'Speaking tasks deliver prompt, recording limits, no options',
    sp.length === 2 &&
      sp.every(
        ({ q, s }) =>
          s.question === q.question &&
          s.prepSeconds === q.prepSeconds &&
          s.responseSeconds === q.responseSeconds &&
          s.options.length === 0 &&
          s.productive,
      ),
  );
  ok(
    'Writing tasks deliver prompt and word bounds, no options',
    wr.length === 2 &&
      wr.every(
        ({ q, s }) =>
          s.wordMin === q.wordMin &&
          s.wordMax === q.wordMax &&
          s.options.length === 0,
      ),
  );
  ok(
    'Listening items state NOT_READY with a null audioUrl',
    ls.length === 10 &&
      ls.every(({ s }) => s.audioUrl === null && s.mediaStatus === 'NOT_READY'),
  );
  const passages = await prisma.diagnosticReadingPassage.findMany({
    where: { assessmentId: 5 },
  });
  ok(
    'Reading items deliver their complete authored passage',
    rd.length === 10 &&
      rd.every(
        ({ q, s }) =>
          s.passageBody?.trim() ===
          passages.find((p) => p.id === q.passageId)?.text.trim(),
      ),
  );
  const forbidden = [
    'correctIndex',
    'explanation',
    'sourceKey',
    'stableKey',
    'difficulty',
    'intendedLevel',
    'rubricId',
    'passageId',
    'internalLabel',
    'answerRationale',
    'script',
  ];
  const leaked = forbidden.filter((k) => out.some(({ s }) => k in s));
  ok(
    'no confidential field in any DRAFT payload',
    leaked.length === 0,
    leaked.join(','),
  );

  console.log(`\nC1_ISOLATED_FAILURES=${failures}  (${results.length} checks)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(
    'C1 ISOLATED ERROR:',
    String(e?.message ?? e)
      .split('\n')
      .slice(-3)
      .join(' '),
  );
  process.exit(2);
});
