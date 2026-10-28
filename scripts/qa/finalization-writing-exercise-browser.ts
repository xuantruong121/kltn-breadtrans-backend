/**
 * Multi-task Writing exercise in Chromium on the disposable harness, with the
 * deterministic grader (scripts/qa/writing-deterministic-server.ts) serving
 * :3101. Exercise 3 has three sentence tasks: the learner answers them one at
 * a time; XP is granted once, when the third task is graded, from the mean of
 * the three grades; a retake grants nothing more.
 *
 * Usage: WRITING_QA_COUNTER_FILE=<file> npx ts-node scripts/qa/finalization-writing-exercise-browser.ts
 */
import { readFileSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { harnessQuery } from './harness-db';
import { FE, hidePet, studentPage } from './harness-browser';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots`;
const QUIZ = 3;

const counterFile = process.env.WRITING_QA_COUNTER_FILE;
const graderCalls = () =>
  counterFile
    ? Number(JSON.parse(readFileSync(counterFile, 'utf8')).calls)
    : NaN;

async function main() {
  const callsAtStart = graderCalls();
  const { browser, page, account } = await studentPage('wr-ex', 1366);
  const xp = () =>
    harnessQuery(
      `select reason, points from "PointHistory" where "userId" = ${account.userId} and reason = 'Hoàn thành bài thi (Quiz)'`,
    );
  const rewards = () =>
    Number(
      harnessQuery(
        `select count(*) from "UserQuizReward" where "userId" = ${account.userId} and "quizId" = ${QUIZ}`,
      )[0][0],
    );
  const answers = [
    'My manager ask me to book a room for the meeting tomorrow.',
    'The train was delayed because of heavy rain.',
    'The staff spoke to the customer politely.',
  ];

  await page.goto(`${FE}/writing/${QUIZ}`);
  await hidePet(page);
  await page.waitForURL(/[?&]q=\d+/, { timeout: 30_000 });
  check(
    'the page lists the three tasks of the exercise',
    await page
      .getByText(/Bài gồm 3 câu/)
      .waitFor({ timeout: 30_000 })
      .then(
        () => true,
        () => false,
      ),
  );

  for (let i = 0; i < 3; i += 1) {
    if (i > 0) {
      await page.getByRole('button', { name: /Làm câu tiếp theo/ }).click();
      await page.waitForURL(/\/writing\/3\?/, { timeout: 30_000 });
    }
    const box = page.locator('textarea').first();
    await box.waitFor({ timeout: 30_000 });
    await box.fill(answers[i]);
    await page.getByRole('button', { name: /Gửi đánh giá bài viết/ }).click();
    await page.waitForURL(/\/writing\/submissions\/\d+/, { timeout: 60_000 });
    await page
      .getByText(`Câu ${i + 1}/3 · Kết quả đã lưu`)
      .waitFor({ timeout: 30_000 });
    const body = await page.locator('body').innerText();
    if (i === 0) {
      check(
        'task 1: the known error is corrected, quoting the learner',
        body.includes('Lỗi cần sửa trong bài của bạn') &&
          body.includes('manager asks'),
      );
      check(
        'task 1: the exercise is 1/3, not complete',
        body.includes('Đã chấm 1/3 câu'),
      );
      check(
        'task 1: no XP and no exercise reward yet',
        xp().length === 0 && rewards() === 0,
        JSON.stringify(xp()),
      );
    }
    if (i === 1) {
      check(
        'task 2: the prompt shown is task 2 ("because / delayed")',
        /because \/ delayed/.test(body),
      );
      check('task 2: still no XP', xp().length === 0);
    }
    if (i === 2) {
      check(
        'task 3: the exercise is complete with its score',
        /Đã hoàn thành cả 3 câu · điểm bài \d+%/.test(body),
      );
      await page.screenshot({
        path: `${SHOTS}/writing-exercise-complete.png`,
        fullPage: true,
      });
    }
  }

  // Exercise score: mean of each task's latest grade, as a percentage.
  const grades = harnessQuery(
    `select r."questionId", r.score, s."aiFeedback"::json->>'maxScore' from "Result" r join "Submission" s on s.id = r."submissionId" where s."userId" = ${account.userId} and s."quizId" = ${QUIZ} order by s.id`,
  );
  const percent = Math.round(
    grades.reduce((n, g) => n + (Number(g[1]) / Number(g[2])) * 100, 0) /
      grades.length,
  );
  await page.waitForTimeout(1000);
  check(
    'XP granted once, at completion, equal to the exercise percent (CP57-O1)',
    xp().length === 1 &&
      Number(xp()[0][1]) === Math.round(percent) &&
      rewards() === 1,
    `${JSON.stringify(xp())} expected ${Math.round(percent)}`,
  );

  await page.reload();
  await page.getByText(/Đã hoàn thành cả 3 câu/).waitFor({ timeout: 30_000 });
  check('the completed state survives a reload', true);

  await page.goto(`${FE}/writing/${QUIZ}`);
  await page
    .getByText(/đã chấm 3\/3 · điểm bài \d+%/)
    .waitFor({ timeout: 30_000 });
  check('the exercise page shows 3/3 graded with the exercise score', true);
  await page.screenshot({
    path: `${SHOTS}/writing-exercise-tasks.png`,
    fullPage: true,
  });

  // Retake task 1: new grade, no new reward.
  await page.getByRole('button', { name: /^Câu 1/ }).click();
  await page.waitForURL(/q=\d+/);
  await page
    .locator('textarea')
    .first()
    .fill('My manager asks me to book a room for the meeting tomorrow.');
  await page.getByRole('button', { name: /Gửi đánh giá bài viết/ }).click();
  await page.waitForURL(/\/writing\/submissions\/\d+/, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  check(
    'a retake grants no further XP or reward',
    xp().length === 1 && rewards() === 1,
  );

  if (counterFile)
    check(
      'grader called once per answer (4 this run)',
      graderCalls() - callsAtStart === 4,
      String(graderCalls() - callsAtStart),
    );
  await browser.close();
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

void main();
