/**
 * TOEIC 4 Skills in real Chromium on the disposable harness (deterministic
 * writing grader + mock Speaking evaluator on :3101).
 *
 *  - L&R opened from the assessment page enters fullscreen from that click
 *    and uses the strict continuous paper (200 questions, Reading locked).
 *  - Writing opens at the first unwritten task with the A/B/C strip, no
 *    coaching panel, and moves to the next task after a submission; the
 *    assessment page marks written tasks.
 *  - Speaking in the exam is labelled as the exam and returns to it.
 *  - Persisted XP / Bread / quest deltas stay 0.
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';

function balance(userId: number) {
  const one = (sql: string) => Number(harnessQuery(sql)[0][0]);
  return [
    one(
      `select coalesce(sum(points), 0) from "PointHistory" where "userId" = ${userId}`,
    ),
    one(
      `select coalesce(max("totalBanhRan"), 0) from "UserStats" where "userId" = ${userId}`,
    ),
    one(`select count(*) from "BanhTransaction" where "userId" = ${userId}`),
    one(
      `select coalesce(sum("currentValue"), 0) from "UserQuestProgress" where "userId" = ${userId}`,
    ),
  ];
}

async function main() {
  const { browser, page, account, issues } = await studentPage(
    'toeic-4s-ui',
    1366,
  );
  await hidePet(page);
  const before = balance(account.userId);
  const start = await call(
    'POST',
    '/toeic/assessments/2/attempts',
    account.token,
    { idempotencyKey: randomUUID() },
  );
  check(
    '4 Skills parent attempt starts',
    start.status < 300,
    `(status ${start.status})`,
  );
  const attemptId = start.data.id as number;
  const comp = (kind: string) =>
    start.data.components.find((c: any) => c.kind === kind);
  const assessmentUrl = `${FE}/toeic/assessments/2/attempts/${attemptId}`;

  console.log('\n== L&R from the assessment page');
  await page.goto(assessmentUrl, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('button', { name: /Listening \+ Reading/ }).click();
  await page.waitForURL(/\/toeic\/attempts\/\d+/, { timeout: 60_000 });
  await page
    .locator('article[data-question-id]')
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  const childId = Number(/attempts\/(\d+)/.exec(page.url())?.[1]);
  check(
    'L&R child opens in fullscreen from the assessment click',
    await page.evaluate(() => Boolean(document.fullscreenElement)),
  );
  const childTabs = await page
    .getByRole('tablist', { name: 'Part' })
    .getByRole('tab')
    .count();
  check('child is the Full Test page: seven Part tabs', childTabs === 7);
  check(
    'child Full Test plays the seekable Listening master',
    await page.evaluate(() =>
      (document.querySelector('audio') as HTMLAudioElement).currentSrc.includes(
        'listening-master',
      ),
    ),
  );
  await page.getByRole('tab', { name: 'Part 5' }).click();
  await page.locator('#q-101 input[type="radio"]').nth(0).check();
  await page.waitForTimeout(1500);
  check(
    'Reading can be answered right away (no section lock)',
    harnessQuery(
      `select count(*) from "ToeicAttemptAnswer" where "attemptId" = ${childId}`,
    )[0][0] === '1',
  );
  await page.screenshot({ path: `${SHOTS}/toeic-4s-lr.png` });
  await call('POST', `/toeic/attempts/${childId}/submit`, account.token, {});
  const lrDone = await call(
    'POST',
    `/toeic/assessments/attempts/${attemptId}/components/${comp('LISTENING_READING').assessmentComponentId}/complete`,
    account.token,
    {},
  );
  check(
    'L&R component completes after the child is submitted',
    lrDone.status < 300,
    `(status ${lrDone.status})`,
  );

  console.log('\n== Writing in the exam');
  await page.goto(assessmentUrl, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('button', { name: /Writing/ }).click();
  await page.waitForURL(/\/writing\/\d+/, { timeout: 60_000 });
  await page
    .getByRole('navigation', { name: 'Các câu phần Viết' })
    .waitFor({ timeout: 60_000 });
  const firstQuiz = Number(/writing\/(\d+)/.exec(page.url())?.[1]);
  const wr = comp('WRITING');
  check(
    'Writing opens at task 1 of 8',
    firstQuiz === wr.writingQuizIds[0],
    `(${firstQuiz})`,
  );
  let body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'strip shows group A, the task position and the required words',
    body.includes('Nhóm A — Viết câu theo tranh') &&
      /câu 1\/8/i.test(body) &&
      body.includes('Từ bắt buộc'),
  );
  check('no coaching panel during the exam', !body.includes('Mẫu Câu Hữu Ích'));
  await page.screenshot({
    path: `${SHOTS}/toeic-4s-writing-q1.png`,
    fullPage: true,
  });
  await page
    .locator('textarea')
    .first()
    .fill('The woman is reading a report at her desk in the office.');
  await page.getByRole('button', { name: /Gửi đánh giá bài viết/ }).click();
  await page.waitForURL(
    (u) => u.pathname === `/writing/${wr.writingQuizIds[1]}`,
    { timeout: 90_000 },
  );
  check('after submitting task 1 the exam moves to task 2 by itself', true);
  await page
    .getByRole('navigation', { name: 'Các câu phần Viết' })
    .waitFor({ timeout: 30_000 });
  body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'task 2 strip counts one submitted task',
    /câu 2\/8/i.test(body) && /đã nộp 1\/8/i.test(body),
  );
  const view = await call(
    'GET',
    `/toeic/assessments/attempts/${attemptId}`,
    account.token,
  );
  const written = view.data.components.find(
    (c: any) => c.kind === 'WRITING',
  ).writtenQuizIds;
  check(
    'server reports task 1 as written',
    JSON.stringify(written) === JSON.stringify([wr.writingQuizIds[0]]),
    JSON.stringify(written),
  );
  await page.goto(assessmentUrl, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('button', { name: /Writing/ }).click();
  await page.waitForURL(/\/writing\/\d+/, { timeout: 60_000 });
  check(
    'reopening Writing resumes at the first unwritten task (task 2)',
    page.url().includes(`/writing/${wr.writingQuizIds[1]}`),
    `(${page.url().slice(21, 60)})`,
  );

  console.log('\n== Speaking in the exam');
  await page.goto(assessmentUrl, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('button', { name: /Speaking/ }).click();
  await page.waitForURL(/\/speaking\/\d+/, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'Speaking is labelled as the exam and offers "Về bài thi"',
    body.includes('TOEIC Speaking') &&
      body.includes('Về bài thi') &&
      !body.includes('Danh sách bài'),
  );
  check(
    'no bilingual coaching toggle in the exam',
    (await page.getByRole('button', { name: /Song ngữ/ }).count()) === 0,
  );
  await page.screenshot({ path: `${SHOTS}/toeic-4s-speaking-q1.png` });

  await new Promise((ok) => setTimeout(ok, 2500));
  const delta = balance(account.userId).map((v, i) => v - before[i]);
  check(
    '4 Skills UI journey: XP 0, Bread 0, ledger 0, quests 0',
    delta.every((v) => v === 0),
    `(${delta.join(',')})`,
  );
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api')).join(' | '),
  );
  await browser.close();
  console.log(`\nTOEIC_4S_UI_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
