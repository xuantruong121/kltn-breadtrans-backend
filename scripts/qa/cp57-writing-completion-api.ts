/**
 * Checkpoint 57: a multi-task Writing exercise is "completed" in the catalog
 * only after every task is graded, and its reward is paid once, at that point.
 * Harness only (deterministic writing grader).
 * Usage: npx ts-node --transpile-only scripts/qa/cp57-writing-completion-api.ts
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const QUIZ = 17; // Writing A2 — five tasks, FREE
const ANSWER =
  'Hi Lan, thanks for your message. I can meet you on Saturday at ten near the library. I will bring the notes from class and we can study together for two hours. See you soon, Minh';

void (async () => {
  const a = await newStudent('cp57-writing');
  const tasks = harnessQuery(
    `select id from "Question" where "quizId" = ${QUIZ} order by "order", id`,
  ).map((r) => Number(r[0]));
  check('quiz 17 has five tasks', tasks.length === 5, `(${tasks.length})`);
  const completed = async () =>
    ((await call('GET', '/writing/topics', a.token)).data?.quizzes ?? []).find(
      (q: any) => q.id === QUIZ,
    )?.isCompleted;
  const xp = () =>
    Number(
      harnessQuery(
        `select coalesce(sum(points), 0) from "PointHistory" where "userId" = ${a.userId}`,
      )[0][0],
    );
  const settle = () => new Promise((ok) => setTimeout(ok, 3000));

  check('not completed before any submission', (await completed()) === false);
  for (const [i, questionId] of tasks.entries()) {
    const r = await call('POST', `/writing/quizzes/${QUIZ}/submit`, a.token, {
      answer: ANSWER,
      questionId,
      clientAttemptId: randomUUID(),
    });
    await settle();
    const last = i === tasks.length - 1;
    check(
      `task ${i + 1}/5 graded; catalog completed = ${last}`,
      r.status < 300 && (await completed()) === last,
      `(${r.status})`,
    );
    if (i === 0)
      check('no reward after the first task', xp() === 0, `(xp ${xp()})`);
  }
  const rewarded = xp();
  check(
    'reward paid once the exercise is complete',
    rewarded > 0,
    `(xp ${rewarded})`,
  );
  await call('POST', `/writing/quizzes/${QUIZ}/submit`, a.token, {
    answer: ANSWER,
    questionId: tasks[0],
    clientAttemptId: randomUUID(),
  });
  await settle();
  check('a retake earns no second reward', xp() === rewarded, `(xp ${xp()})`);
  console.log(`CP57_WRITING_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
