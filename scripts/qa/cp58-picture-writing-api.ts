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
    'B1: the result reports the connector of a linked sentence',
    proTry.data?.linking?.found !== undefined,
    JSON.stringify(proTry.data?.linking),
  );
  const b1Detail = JSON.stringify(
    (await call('GET', `/writing/quizzes/${B1}`, pro.token)).data,
  );
  check(
    'B1 instructions tell the learner to link two ideas in one sentence',
    b1Detail.includes('MỘT câu') && b1Detail.includes('từ nối'),
  );
  const linked = await submit(
    pro,
    B1,
    b1Tasks[3],
    'A worker stands on a ladder so that he can replace a light [[percent:90]].',
  );
  check(
    'B1 linked sentence: connector "so that", one sentence, cues found',
    linked.data?.linking?.found === 'so that' &&
      linked.data?.linking?.sentences === 1 &&
      linked.data?.keywords?.every((k: any) => k.present),
    JSON.stringify([linked.data?.linking, linked.data?.keywords]),
  );
  const split = await submit(
    pro,
    B1,
    b1Tasks[4],
    'There are bicycles in a rack. The entrance has a door [[percent:60]].',
  );
  check(
    'B1 two short sentences: no connector, two sentences reported',
    split.data?.linking?.found === null && split.data?.linking?.sentences === 2,
    JSON.stringify(split.data?.linking),
  );
  const offTopic = await submit(
    pro,
    B1,
    b1Tasks[1],
    'My favourite food is pizza because it is delicious. [[percent:10]]',
  );
  check(
    'off-topic answer: both cue words reported missing',
    offTopic.data?.keywords?.every((k: any) => !k.present),
    JSON.stringify(offTopic.data?.keywords),
  );
  const a2Answer = await submit(
    pro,
    A2,
    tasksOf(A2)[0],
    'The cashier scans a jar. [[percent:90]]',
  );
  check(
    'A2 results carry no linking rule',
    a2Answer.status < 300 && a2Answer.data?.linking === undefined,
  );
  check(
    'PRO grades B1 picture writing',
    proTry.status < 300,
    `(${proTry.status})`,
  );

  console.log('\n== Scene relevance (CP58-H, mock verdicts)');
  const sceneUser = await newStudent('cp58-pic-scene');
  await grant(admin.token, sceneUser.userId, 'PRO');
  const sb1 = tasksOf(B1);
  const mismatch = await submit(
    sceneUser,
    B1,
    sb1[2],
    'Two children are drawing a plan for a sandcastle at the beach site because they want to win a prize [[scene:MISMATCH]] [[percent:90]].',
  );
  const mismatchRow = harnessQuery(
    `select s.score, r.score from "Submission" s join "Result" r on r."submissionId" = s.id where s.id = ${mismatch.data?.submissionId}`,
  )[0];
  check(
    'MISMATCH with cue words + connector: final <= 4/10, task completion 0, adjustment recorded',
    mismatch.data?.score <= 4 &&
      mismatch.data?.criteria?.find((c: any) => c.key === 'taskCompletion')
        ?.score === 0 &&
      mismatch.data?.scoreAdjustment?.reason === 'SCENE_MISMATCH' &&
      mismatch.data?.scene?.match === 'MISMATCH',
    JSON.stringify([mismatch.data?.score, mismatch.data?.scoreAdjustment]),
  );
  check(
    'persisted submission and result use the capped score',
    Number(mismatchRow?.[0]) === mismatch.data?.score &&
      Number(mismatchRow?.[1]) === mismatch.data?.score,
    JSON.stringify(mismatchRow),
  );
  const analytics = await call(
    'GET',
    `/quizzes/submissions/${mismatch.data?.submissionId}/analytics`,
    sceneUser.token,
  );
  check(
    'result view serves the same capped score',
    JSON.stringify(analytics.data ?? {}).includes(
      `"score":${mismatch.data?.score}`,
    ),
  );
  const partial = await submit(
    sceneUser,
    B1,
    sb1[0],
    'A manager points at a chart during a presentation while people sit [[scene:PARTIAL]] [[percent:80]].',
  );
  check(
    'PARTIAL is not capped',
    partial.data?.score === 8 && !partial.data?.scoreAdjustment,
    JSON.stringify([partial.data?.score]),
  );
  const uncertain = await submit(
    sceneUser,
    B1,
    sb1[1],
    'A woman is putting a file on a shelf while she organises the office [[scene:UNCERTAIN]] [[percent:90]].',
  );
  check(
    'UNCERTAIN alternative description is not capped',
    uncertain.data?.score === 10 && !uncertain.data?.scoreAdjustment,
  );
  for (const q of [sb1[3], sb1[4]])
    await submit(
      sceneUser,
      B1,
      q,
      'A worker stands on a ladder so that he can replace a light [[percent:100]].',
    );
  await settle();
  const sceneEx = (await call('GET', `/writing/quizzes/${B1}`, sceneUser.token))
    .data?.exercise;
  check(
    `completion XP uses the capped task score (percent ${sceneEx?.percent})`,
    sceneEx?.complete === true && xp(sceneUser) === sceneEx?.percent,
    `(xp ${xp(sceneUser)})`,
  );

  console.log(`\nCP58_PICTURE_WRITING_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
