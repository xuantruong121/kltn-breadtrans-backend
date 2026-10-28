/**
 * Checkpoint 57-O1: Writing XP on the harness (deterministic grader; the
 * learner text carries "[[percent:NN]]" or "[[fail]]" for the QA grader).
 *   - XP of a completed exercise = its final percent (0/50/75/92/100);
 *   - tasks 1-4 pay nothing, task 5 pays once; a replayed key, a retake and
 *     two concurrent last-task submissions pay nothing more;
 *   - a failed grading neither counts as graded nor pays;
 *   - Bread follows the unchanged rule min(40, max(10, round(score × 0.4)));
 *   - PointHistory equals the credited XP; quests follow existing rules.
 * Usage: npx ts-node --transpile-only scripts/qa/cp57-writing-xp-api.ts
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const QUIZ = 17; // Writing A2, five tasks, FREE
const TEXT =
  'Hi Lan, thanks for your message. I can meet you on Saturday at ten near the library. I will bring the notes and we can study together. See you, Minh';
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
const settle = () => new Promise((ok) => setTimeout(ok, 2500));
const tasks = harnessQuery(
  `select id from "Question" where "quizId" = ${QUIZ} order by "order", id`,
).map((r) => Number(r[0]));

type Learner = Awaited<ReturnType<typeof newStudent>>;
const xp = (u: Learner) =>
  Number(
    one(
      `select coalesce(sum(points),0) from "PointHistory" where "userId" = ${u.userId} and reason = 'Hoàn thành bài thi (Quiz)'`,
    ),
  );
const bread = (u: Learner) =>
  Number(
    one(
      `select coalesce(sum(amount),0) from "BanhTransaction" where "userId" = ${u.userId} and source = 'QUIZ_FIRST_COMPLETION'`,
    ),
  );
const breadRows = (u: Learner) =>
  Number(
    one(
      `select count(*) from "BanhTransaction" where "userId" = ${u.userId} and source = 'QUIZ_FIRST_COMPLETION'`,
    ),
  );

const submit = (
  u: Learner,
  questionId: number,
  text: string,
  key = randomUUID(),
) =>
  call('POST', `/writing/quizzes/${QUIZ}/submit`, u.token, {
    answer: text,
    questionId,
    clientAttemptId: key,
  });

const percentOf = async (u: Learner): Promise<number> =>
  (await call('GET', `/writing/quizzes/${QUIZ}`, u.token)).data?.exercise
    ?.percent;

async function complete(u: Learner, percent: number) {
  for (const q of tasks) await submit(u, q, `${TEXT} [[percent:${percent}]]`);
  await settle();
}

void (async () => {
  check('quiz 17 has five tasks', tasks.length === 5);

  // 1-5: XP equals the final exercise percent.
  for (const pct of [0, 50, 75, 92, 100]) {
    const u = await newStudent(`xp${pct}`);
    await complete(u, pct);
    const percent = await percentOf(u);
    const got = xp(u);
    // Unchanged Bread rule; a 0-XP completion pays no completion Bread.
    const expectedBread =
      percent > 0 ? Math.min(40, Math.max(10, Math.round(percent * 0.4))) : 0;
    check(
      `grader ${pct}% → exercise ${percent}% → ${percent} XP`,
      typeof percent === 'number' && got === percent,
      `(xp ${got})`,
    );
    check(
      `final ${pct}%: Bread unchanged rule → ${expectedBread}`,
      bread(u) === expectedBread,
      `(bread ${bread(u)})`,
    );
  }

  // 6-9: partial progress pays nothing; completion pays once.
  const a = await newStudent('xp-steps');
  let paid = -1;
  for (const [i, q] of tasks.entries()) {
    const key = randomUUID();
    await submit(a, q, `${TEXT} [[percent:80]]`, key);
    await settle();
    if (i < 4)
      check(`task ${i + 1}/5: no completion XP`, xp(a) === 0, `(xp ${xp(a)})`);
    if (i === 4) {
      const percent = await percentOf(a);
      paid = xp(a);
      check(
        `task 5/5: completion XP = exercise percent ${percent}`,
        paid === percent && breadRows(a) === 1,
        `(xp ${paid})`,
      );
      await submit(a, q, `${TEXT} [[percent:80]]`, key);
      await percentOf(a);
      await settle();
      check('replayed key and reopened result: no second XP', xp(a) === paid);
    }
  }
  await submit(a, tasks[0], `${TEXT} [[percent:100]]`);
  await settle();
  check(
    'a retake after completion pays nothing',
    xp(a) === paid && breadRows(a) === 1,
  );
  check(
    'exactly one completion XP row in PointHistory',
    one(
      `select count(*) from "PointHistory" where "userId" = ${a.userId} and reason = 'Hoàn thành bài thi (Quiz)'`,
    ) === '1',
  );

  // 10: two concurrent submissions of the last task.
  const c = await newStudent('xp-concurrent');
  for (const q of tasks.slice(0, 4))
    await submit(c, q, `${TEXT} [[percent:60]]`);
  await Promise.all([
    submit(c, tasks[4], `${TEXT} [[percent:60]]`),
    submit(c, tasks[4], `${TEXT} [[percent:60]]`),
  ]);
  await settle();
  const cPercent = await percentOf(c);
  check(
    'concurrent last-task submissions pay once',
    xp(c) === cPercent && breadRows(c) === 1,
    `(xp ${xp(c)}, percent ${cPercent}, bread rows ${breadRows(c)})`,
  );

  // 12: a failed grading is not a graded task and pays nothing.
  const f = await newStudent('xp-fail');
  for (const q of tasks.slice(0, 4))
    await submit(f, q, `${TEXT} [[percent:70]]`);
  const failed = await submit(f, tasks[4], `${TEXT} [[fail]]`);
  await settle();
  const catalog = (
    await call('GET', '/writing/topics', f.token)
  ).data?.quizzes?.find((q: any) => q.id === QUIZ);
  check(
    'failed grading on the last task: refused, not completed, no XP',
    failed.status >= 400 && catalog?.isCompleted === false && xp(f) === 0,
    `(${failed.status}, completed ${catalog?.isCompleted}, xp ${xp(f)})`,
  );
  await submit(f, tasks[4], `${TEXT} [[percent:70]]`);
  await settle();
  const fPercent = await percentOf(f);
  check(
    'after a successful retry the exercise completes and pays its percent',
    xp(f) === fPercent,
    `(xp ${xp(f)}, percent ${fPercent})`,
  );

  // 15: quests follow the existing rule (COMPLETE_QUIZ advances on the reward).
  const quest = one(
    `select coalesce(max(p."currentValue"),0) from "UserQuestProgress" p join "DailyQuest" d on d.id = p."questId" where p."userId" = ${a.userId} and d.type = 'COMPLETE_QUIZ'`,
  );
  check(
    'COMPLETE_QUIZ quest advanced by the completion',
    Number(quest) >= 1,
    `(${quest})`,
  );

  console.log(`CP57_WRITING_XP_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
