/**
 * Checkpoint 58 "Viết câu theo tranh" through the real API on the harness
 * (deterministic grader; "[[percent:NN]]" in the text sets the grade).
 *   - the catalog exposes each picture with its two cue words and level,
 *     never the scene description or the sample answer;
 *   - A2 is FREE, B1 needs PRO (PLUS refused);
 *   - a picture answer over 40 words is refused, 40 is accepted;
 *   - the exercise completes only after all five pictures, pays its percent
 *     as XP once, and a retake pays nothing more.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-picture-writing-api.ts
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const one = (sql: string) => harnessQuery(sql)[0]?.[0];
const settle = () => new Promise((ok) => setTimeout(ok, 2500));
type Learner = Awaited<ReturnType<typeof newStudent>>;

const quizId = (title: string) =>
  Number(one(`select id from "Quiz" where title = '${title}'`));
const A2 = quizId('Viết câu theo tranh: đời sống và dịch vụ (A2)');
const B1 = quizId('Viết câu theo tranh: nơi làm việc (B1)');
const tasksOf = (quiz: number) =>
  harnessQuery(
    `select id from "Question" where "quizId" = ${quiz} order by "order", id`,
  ).map((r) => Number(r[0]));

const submit = (u: Learner, quiz: number, questionId: number, text: string) =>
  call('POST', `/writing/quizzes/${quiz}/submit`, u.token, {
    answer: text,
    questionId,
    clientAttemptId: randomUUID(),
  });
const xp = (u: Learner) =>
  Number(
    one(
      `select coalesce(sum(points),0) from "PointHistory" where "userId" = ${u.userId} and reason = 'Hoàn thành bài thi (Quiz)'`,
    ),
  );

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
    reason: 'CP58 picture writing',
  });
  if (r.status >= 300) throw new Error(`grant ${code} ${r.status}`);
}

void (async () => {
  check('both picture exercises exist', A2 > 0 && B1 > 0, `(${A2}, ${B1})`);
  const free = await newStudent('cp58-pic-free');

  console.log('\n== Catalog');
  const cat = (await call('GET', '/writing/topics', free.token)).data
    ?.quizzes as any[];
  const a2 = cat.find((q) => q.id === A2);
  const b1 = cat.find((q) => q.id === B1);
  check(
    'A2: picture task, level A2, FREE, open',
    a2?.taskType === 'PICTURE_SENTENCE' &&
      a2?.cefrLevel === 'A2' &&
      a2?.requiredPlan === 'FREE' &&
      a2?.isLocked === false,
  );
  check(
    'B1: level B1, PRO, locked for FREE, pictures still listed',
    b1?.cefrLevel === 'B1' &&
      b1?.requiredPlan === 'PRO' &&
      b1?.isLocked === true &&
      b1?.pictureTasks?.length === 5,
  );
  check(
    'five pictures with an image and two cue words each',
    a2?.pictureTasks?.length === 5 &&
      a2.pictureTasks.every(
        (t: any) =>
          /^https?:\/\/.+\.png$/.test(t.imageUrl) && t.keywords.length === 2,
      ),
  );
  const raw = JSON.stringify(cat);
  check(
    'catalog never carries the scene description or the sample answer',
    !raw.includes('sceneDescription') &&
      !raw.includes('sampleResponse') &&
      !raw.includes('scanning a jar'),
  );
  const detail = JSON.stringify(
    (await call('GET', `/writing/quizzes/${A2}`, free.token)).data,
  );
  check(
    'detail has the five tasks without the scene description',
    detail.includes('"wordRange":[1,40]') &&
      !detail.includes('sceneDescription') &&
      !detail.includes('a black apron'),
  );
  const image = await fetch(a2.pictureTasks[0].imageUrl, { method: 'HEAD' });
  check(
    'the first picture loads',
    image.ok && (image.headers.get('content-type') ?? '').startsWith('image/'),
  );

  console.log('\n== 40-word limit');
  const tasks = tasksOf(A2);
  const long = await submit(
    free,
    A2,
    tasks[0],
    `The cashier is scanning ${'very '.repeat(37)}slowly.`,
  );
  check(
    'a 41-word answer is refused with the limit',
    long.status === 400 && JSON.stringify(long).includes('40 từ'),
    `(${long.status})`,
  );
  const forty = await submit(
    free,
    A2,
    tasks[0],
    `The cashier scans a jar ${'and '.repeat(33)}smiles [[percent:80]]`,
  );
  check('a 40-word answer is graded', forty.status < 300, `(${forty.status})`);

  console.log('\n== Completion and XP');
  const first = (await call('GET', '/writing/topics', free.token)).data
    ?.quizzes as any[];
  check(
    'one graded picture: in progress, not completed, no XP',
    first.find((q) => q.id === A2)?.completionStatus === 'IN_PROGRESS' &&
      first.find((q) => q.id === A2)?.isCompleted === false &&
      xp(free) === 0,
  );
  // Tasks 2-5 with the cases the server decides itself (the mock grader
  // decides the score; real grading quality is not proven here).
  const cueOf = (body: any) =>
    Object.fromEntries(
      (body?.data?.keywords ?? []).map((k: any) => [k.keyword, k.present]),
    );
  const alt = await submit(
    free,
    A2,
    tasks[1],
    'Two customers are ordering drinks at the café counter. [[percent:80]]',
  );
  check(
    'alternative wording with "ordering": both cues found',
    cueOf(alt).order === true && cueOf(alt).counter === true,
    JSON.stringify(cueOf(alt)),
  );
  const inflected = await submit(
    free,
    A2,
    tasks[2],
    'A delivery man carried three boxes into the shop. [[percent:80]]',
  );
  check(
    'inflection "carried": cue "carry" found',
    cueOf(inflected).carry === true && cueOf(inflected).boxes === true,
    JSON.stringify(cueOf(inflected)),
  );
  const missing = await submit(
    free,
    A2,
    tasks[3],
    'A man is bringing food to two guests. [[percent:80]]',
  );
  check(
    'missing cue: "waiter" and "table" reported absent',
    cueOf(missing).waiter === false && cueOf(missing).table === false,
    JSON.stringify(cueOf(missing)),
  );
  const mid = (await call('GET', `/writing/quizzes/${A2}`, free.token)).data
    ?.exercise;
  check(
    '4/5 graded: still in progress, no XP yet',
    mid?.answered === 4 && mid?.complete === false && xp(free) === 0,
    JSON.stringify({ answered: mid?.answered, complete: mid?.complete }),
  );
  // A replayed request (same key) is graded once.
  const key = randomUUID();
  const body = {
    answer:
      'Two travellers with suitcases look at the departure board. [[percent:80]]',
    questionId: tasks[4],
    clientAttemptId: key,
  };
  const r1 = await call(
    'POST',
    `/writing/quizzes/${A2}/submit`,
    free.token,
    body,
  );
  const r2 = await call(
    'POST',
    `/writing/quizzes/${A2}/submit`,
    free.token,
    body,
  );
  check(
    'a replayed submission returns the same result, stored once',
    r1.data?.submissionId === r2.data?.submissionId &&
      one(
        `select count(*) from "Submission" where "userId" = ${free.userId} and "quizId" = ${A2}`,
      ) === '5',
  );
  await settle();
  const percent = (await call('GET', `/writing/quizzes/${A2}`, free.token)).data
    ?.exercise?.percent;
  const after = (await call('GET', '/writing/topics', free.token)).data
    ?.quizzes as any[];
  check(
    'all five graded: completed',
    after.find((q) => q.id === A2)?.completionStatus === 'COMPLETED' &&
      after.find((q) => q.id === A2)?.isCompleted === true,
  );
  check(
    `XP = exercise percent (${percent}), within 0–100`,
    xp(free) === percent && percent >= 0 && percent <= 100,
    `(xp ${xp(free)})`,
  );
  await submit(
    free,
    A2,
    tasks[0],
    'The cashier is scanning a jar while a woman pays. [[percent:100]]',
  );
  await settle();
  check('a retake pays no second reward', xp(free) === percent);

  console.log('\n== Plans');
  const admin = await newAdmin('cp58-pic-admin');
  const plus = await newStudent('cp58-pic-plus');
  await grant(admin.token, plus.userId, 'PLUS');
  const b1Tasks = tasksOf(B1);
  const plusTry = await submit(
    plus,
    B1,
    b1Tasks[0],
    'A manager gives a presentation about a chart. [[percent:80]]',
  );
  check(
    'PLUS is refused on B1 picture writing with PRO required',
    plusTry.status === 403 && JSON.stringify(plusTry).includes('PRO'),
    `(${plusTry.status})`,
  );
  const pro = await newStudent('cp58-pic-pro');
  await grant(admin.token, pro.userId, 'PRO');
  const proTry = await submit(
    pro,
    B1,
    b1Tasks[0],
    'A manager gives a presentation about a chart. [[percent:80]]',
  );
  check(
    'PRO grades B1 picture writing',
    proTry.status < 300,
    `(${proTry.status})`,
  );

  console.log(`\nCP58_PICTURE_WRITING_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
