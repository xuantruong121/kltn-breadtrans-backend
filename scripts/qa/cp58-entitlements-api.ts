/**
 * Plan matrix (F11.3), through the real API on the harness: Reading free;
 * Listening free except dictation B1+ (PLUS); Speaking and Writing A1-A2
 * free, B1-B2 PLUS, C1+ PRO; flashcards, vocabulary and grammar free; expired
 * paid plans fall back to FREE. Level locks apply on top of any plan (F7.3)
 * and courses stay hidden (F1). Mock graders only.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-entitlements-api.ts <10s.wav>
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  BE,
  call,
  check,
  failureCount,
  newAdmin,
  newStudent,
} from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const wav = readFileSync(process.argv[2]);
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
type Acct = Awaited<ReturnType<typeof newStudent>>;

async function grant(admin: string, userId: number, code: 'PLUS' | 'PRO') {
  const planVersionId = Number(
    one(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and p.code = '${code}'`,
    ),
  );
  const r = await call('POST', '/admin/subscriptions/grant', admin, {
    studentId: userId,
    planVersionId,
    durationDays: 30,
    reason: 'CP58 entitlement matrix',
  });
  if (r.status >= 300) throw new Error(`grant ${code} ${r.status}`);
}
const expire = (userId: number) =>
  harnessExec(
    `update "Subscription" set "startsAt" = now() - interval '31 days', "endsAt" = now() - interval '1 minute' where "userId" = ${userId} and "endsAt" > now()`,
  );

const openAllLevels = (userId: number) =>
  ['LISTENING', 'READING', 'SPEAKING', 'WRITING'].forEach((skill) =>
    harnessExec(
      `insert into "LearnerSkillLevel" ("userId", skill, level, "unlockedLevel", ability, "updatedAt") values (${userId}, '${skill}', 'ADVANCED', 'ADVANCED', 2.35, now()) on conflict ("userId", skill) do update set level = 'ADVANCED', "unlockedLevel" = 'ADVANCED'`,
    ),
  );

const firstInSet = (set: string) =>
  Number(
    one(
      `select id from "SpeakingExercise" where "practiceSetId" = '${set}' order by "order" limit 1`,
    ),
  );

async function speak(a: Acct, id: number) {
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
    'a.wav',
  );
  const r = await fetch(`${BE}/speaking/exercises/${id}/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${a.token}`,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  return r.status;
}
const writeSubmit = async (a: Acct, quizId: number) =>
  (
    await call('POST', `/writing/quizzes/${quizId}/submit`, a.token, {
      answer:
        'Dear Ms Tran, thank you for your message. I can attend the meeting on Thursday and I will bring the updated budget. Best regards, Minh',
      clientAttemptId: randomUUID(),
    })
  ).status;
const quizStatus = async (a: Acct, id: number) =>
  (await call('GET', `/quizzes/${id}`, a.token)).status;
const speakingDetail = async (a: Acct, id: number) =>
  call('GET', `/speaking/exercises/${id}`, a.token);

void (async () => {
  const admin = await newAdmin('cp58-admin');
  const free = await newStudent('cp58-free');
  const plus = await newStudent('cp58-plus');
  const pro = await newStudent('cp58-pro');
  const lowLevel = await newStudent('cp58-pro-basic');
  await grant(admin.token, plus.userId, 'PLUS');
  await grant(admin.token, pro.userId, 'PRO');
  await grant(admin.token, lowLevel.userId, 'PRO');
  // The plan matrix is read with every level open; levels have their own block.
  for (const a of [free, plus, pro]) openAllLevels(a.userId);
  const spkA2 = firstInSet('practice-question-response-a2');
  const spkB1 = firstInSet('practice-pronunciation-b1');
  const spkC1 = firstInSet('practice-opinion-c1');

  console.log('\n== Listening / Reading (free; dictation B1+ PLUS)');
  check('A2 Listening: FREE opens', (await quizStatus(free, 10)) === 200);
  check('B1 Listening: FREE opens', (await quizStatus(free, 11)) === 200);
  check('B1 Reading: FREE opens', (await quizStatus(free, 6)) === 200);
  check('C1 Reading: FREE opens', (await quizStatus(free, 16)) === 200);
  const dictation = await call('GET', '/quizzes/25', free.token);
  check(
    'B1 dictation: FREE refused with PLUS as the required plan',
    dictation.status === 403 && JSON.stringify(dictation).includes('PLUS'),
    `(${dictation.status} ${JSON.stringify(dictation.message).slice(0, 80)})`,
  );
  check('B1 dictation: PLUS opens', (await quizStatus(plus, 25)) === 200);

  console.log('\n== Speaking (A1-A2 free, B1-B2 PLUS, C1+ PRO)');
  check('A2 Speaking: FREE submits', (await speak(free, spkA2)) < 300);
  const freeB1 = await speakingDetail(free, spkB1);
  check(
    'B1 Speaking: FREE refused with PLUS as the required plan',
    freeB1.status === 403 && JSON.stringify(freeB1).includes('PLUS'),
    `(${freeB1.status})`,
  );
  check(
    'B1 Speaking: FREE submission refused',
    (await speak(free, spkB1)) === 403,
  );
  check(
    'B1 Speaking: PLUS opens',
    (await speakingDetail(plus, spkB1)).status === 200,
  );
  const plusC1 = await speakingDetail(plus, spkC1);
  check(
    'C1 Speaking: PLUS refused with PRO as the required plan',
    plusC1.status === 403 && JSON.stringify(plusC1).includes('PRO'),
    `(${plusC1.status})`,
  );
  check('C1 Speaking: PRO submits', (await speak(pro, spkC1)) < 300);
  const catalog = (await call('GET', '/speaking/exercises', free.token))
    .data as any[];
  const b1Row = catalog.find((e) => e.id === spkB1);
  const a2Row = catalog.find((e) => e.id === spkA2);
  check(
    'Speaking catalog for FREE: B1 locked with requiredPlan PLUS, A2 open',
    b1Row?.isLocked === true &&
      b1Row?.requiredPlan === 'PLUS' &&
      a2Row?.isLocked === false,
    JSON.stringify({
      b1: [b1Row?.isLocked, b1Row?.requiredPlan],
      a2: a2Row?.isLocked,
    }),
  );

  console.log('\n== Writing (A1-A2 free, B1-B2 PLUS, C1+ PRO)');
  check('A2 Writing: FREE grades', (await writeSubmit(free, 17)) < 300);
  check(
    'B1 Writing: FREE grading refused',
    (await writeSubmit(free, 18)) === 403,
  );
  check('B1 Writing: PLUS grades', (await writeSubmit(plus, 18)) < 300);
  const wcat =
    (await call('GET', '/writing/topics', free.token)).data?.quizzes ?? [];
  const w18 = wcat.find((q: any) => q.id === 18);
  check(
    'Writing catalog for FREE: B1 locked with requiredPlan PLUS',
    w18?.isLocked === true && w18?.requiredPlan === 'PLUS',
    JSON.stringify([w18?.isLocked, w18?.requiredPlan]),
  );

  console.log('\n== Level locks hold whatever the plan');
  const lowB1 = await call('GET', '/quizzes/6', lowLevel.token);
  check(
    'PRO at Cơ bản: B1 Reading refused as LEVEL_LOCKED',
    lowB1.status === 403 && JSON.stringify(lowB1).includes('LEVEL_LOCKED'),
    `(${lowB1.status})`,
  );
  const lowSpeaking = await speakingDetail(lowLevel, spkB1);
  check(
    'PRO at Cơ bản: B1 Speaking refused as LEVEL_LOCKED',
    lowSpeaking.status === 403 &&
      JSON.stringify(lowSpeaking).includes('LEVEL_LOCKED'),
    `(${lowSpeaking.status})`,
  );
  check(
    'PRO at Cơ bản: A2 Reading opens',
    (await quizStatus(lowLevel, 2)) === 200,
  );

  console.log('\n== Free modules, hidden courses');
  const topics = (await call('GET', '/vocab/topics', free.token)).data;
  const all = [
    ...(topics?.topics ?? []),
    ...(topics?.categories ?? []).flatMap((c: any) => c.topics),
  ];
  check(
    'Flashcard/Vocabulary: FREE sees nothing locked',
    all.length > 0 && all.every((t: any) => !t.isLocked),
  );
  check(
    'Grammar: FREE opens a topic',
    (await call('GET', '/grammar/topics/12', free.token)).status === 200,
  );
  check(
    'Courses are hidden from every plan (COURSES_ENABLED off)',
    (await call('GET', '/courses/1/learning', pro.token)).status === 404,
  );

  console.log('\n== Expiry');
  expire(pro.userId);
  check(
    'expired PRO: C1 Speaking closed again',
    (await speakingDetail(pro, spkC1)).status === 403,
  );
  check(
    'expired PRO: A2 content still open',
    (await quizStatus(pro, 10)) === 200,
  );
  // PLUS ends, PRO starts (admin grant refuses an overlap with 409); the
  // learner's existing practice history must survive the change of plan.
  const readingQs = harnessQuery(
    `select id, content::text from "Question" where "quizId" = 6 order by "order", id`,
  );
  await call('POST', '/quizzes/6/submit', plus.token, {
    answers: readingQs.map(([id, raw]) => ({
      questionId: Number(id),
      answer: (JSON.parse(raw).options ?? ['A'])[0],
    })),
    clientAttemptId: randomUUID(),
  });
  const historyBefore = one(
    `select count(*) from "Submission" where "userId" = ${plus.userId}`,
  );
  expire(plus.userId);
  await grant(admin.token, plus.userId, 'PRO');
  check(
    'PLUS → PRO opens C1 Speaking',
    (await speakingDetail(plus, spkC1)).status === 200,
  );
  check(
    'earlier PLUS history is kept after the upgrade',
    Number(
      one(`select count(*) from "Submission" where "userId" = ${plus.userId}`),
    ) >= Number(historyBefore) && Number(historyBefore) > 0,
    `(before ${historyBefore})`,
  );

  console.log(`\nCP58_ENTITLEMENT_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
