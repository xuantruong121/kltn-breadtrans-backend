/**
 * Checkpoint 58 owner matrix, through the real API on the harness:
 *   Listening/Reading A1/A2 FREE, B1+ PLUS; Speaking/Writing A1/A2 FREE,
 *   B1+ PRO; flashcards/vocabulary/grammar FREE; courses PRO; expired paid
 *   plans fall back to FREE. Mock graders only.
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
  await grant(admin.token, plus.userId, 'PLUS');
  await grant(admin.token, pro.userId, 'PRO');
  const spkA2 = firstInSet('practice-question-response-a2');
  const spkB1 = firstInSet('practice-pronunciation-b1');
  const spkC1 = firstInSet('practice-opinion-c1');

  console.log('\n== Listening / Reading (B1+ PLUS)');
  check('A2 Listening: FREE opens', (await quizStatus(free, 10)) === 200);
  const deny = await call('GET', '/quizzes/11', free.token);
  check(
    'B1 Listening: FREE refused with PLUS as the required plan',
    deny.status === 403 && JSON.stringify(deny).includes('PLUS'),
    `(${deny.status} ${JSON.stringify(deny.message).slice(0, 80)})`,
  );
  check('B1 Listening: PLUS opens', (await quizStatus(plus, 11)) === 200);
  check('B1 Reading: PLUS opens', (await quizStatus(plus, 6)) === 200);
  check('C1 Reading: PRO opens', (await quizStatus(pro, 16)) === 200);

  console.log('\n== Speaking (B1+ PRO)');
  check('A2 Speaking: FREE submits', (await speak(free, spkA2)) < 300);
  const plusB1 = await speakingDetail(plus, spkB1);
  check(
    'B1 Speaking: PLUS refused with PRO as the required plan',
    plusB1.status === 403 && JSON.stringify(plusB1).includes('PRO'),
    `(${plusB1.status})`,
  );
  check(
    'B1 Speaking: PLUS submission refused',
    (await speak(plus, spkB1)) === 403,
  );
  check(
    'B1 Speaking: PRO opens',
    (await speakingDetail(pro, spkB1)).status === 200,
  );
  check('C1 Speaking: PRO submits', (await speak(pro, spkC1)) < 300);
  const catalog = (await call('GET', '/speaking/exercises', plus.token))
    .data as any[];
  const b1Row = catalog.find((e) => e.id === spkB1);
  const a2Row = catalog.find((e) => e.id === spkA2);
  check(
    'Speaking catalog for PLUS: B1 locked with requiredPlan PRO, A2 open',
    b1Row?.isLocked === true &&
      b1Row?.requiredPlan === 'PRO' &&
      a2Row?.isLocked === false,
    JSON.stringify({
      b1: [b1Row?.isLocked, b1Row?.requiredPlan],
      a2: a2Row?.isLocked,
    }),
  );

  console.log('\n== Writing (B1+ PRO)');
  check('A2 Writing: FREE grades', (await writeSubmit(free, 17)) < 300);
  check(
    'B1 Writing: PLUS grading refused',
    (await writeSubmit(plus, 18)) === 403,
  );
  check('B1 Writing: PRO grades', (await writeSubmit(pro, 18)) < 300);
  const wcat =
    (await call('GET', '/writing/topics', plus.token)).data?.quizzes ?? [];
  const w18 = wcat.find((q: any) => q.id === 18);
  const w4 = wcat.find((q: any) => q.id === 4);
  check(
    'Writing catalog for PLUS: B1 items locked with requiredPlan PRO',
    w18?.isLocked === true &&
      w18?.requiredPlan === 'PRO' &&
      w4?.requiredPlan === 'PRO',
    JSON.stringify([w18?.isLocked, w18?.requiredPlan]),
  );
  const lcat =
    (await call('GET', '/quizzes/listening-practice', free.token)).data ?? [];
  const l11 = lcat.find((q: any) => q.id === 11);
  check(
    'Listening catalog for FREE: B1 shows requiredPlan PLUS',
    l11?.isLocked === true && l11?.requiredPlan === 'PLUS',
    JSON.stringify([l11?.isLocked, l11?.requiredPlan]),
  );

  console.log('\n== Free modules and courses');
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
  const course = async (a: Acct) =>
    (await call('GET', '/courses/1/learning', a.token)).status;
  check(
    'Courses: PLUS refused, PRO opens',
    (await course(plus)) === 403 && (await course(pro)) === 200,
  );

  console.log('\n== Expiry');
  expire(pro.userId);
  check(
    'expired PRO: B1 Speaking and courses closed again',
    (await speakingDetail(pro, spkB1)).status === 403 &&
      (await course(pro)) === 403,
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
    'PLUS → PRO opens B1 Speaking and B1 Writing grading',
    (await speakingDetail(plus, spkB1)).status === 200 &&
      (await writeSubmit(plus, 18)) < 300,
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
