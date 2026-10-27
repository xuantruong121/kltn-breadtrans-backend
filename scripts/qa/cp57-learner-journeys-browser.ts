/**
 * Checkpoint 57: learner journeys without a dedicated browser script, on the
 * harness (FE :3100, BE :3101, deterministic writing grader):
 *   Pet feed with no Bread; Flashcard study persistence; one Writing task
 *   through the UI and the catalog's completion state; logout.
 * Usage: npx ts-node --transpile-only scripts/qa/cp57-learner-journeys-browser.ts
 */
import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';
const one = (sql: string) => harnessQuery(sql)[0]?.[0];

void (async () => {
  const { browser, page, account, issues } = await studentPage('cp57-journeys');
  const uid = account.userId;
  const toasts = async () =>
    (await page.locator('[role="status"]').allInnerTexts()).join(' | ');

  // Pet: feeding costs 10 Bread; a learner with 0 Bread must not be charged.
  await page.goto(`${FE}/pet`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(1500);
  const feed = page.getByRole('button', { name: /cho thú cưng ăn/i });
  const disabled = await feed.isDisabled();
  if (!disabled) await feed.click();
  await page.waitForTimeout(2000);
  const msg = await toasts();
  check(
    'Pet: feeding with 0 Bread is blocked or explained in Vietnamese',
    disabled || /Bánh Mì|bánh mì/.test(msg),
    disabled ? '(button disabled)' : msg,
  );
  check(
    'Pet: no Bread is deducted and no ledger row is written',
    one(`select count(*) from "BanhTransaction" where "userId" = ${uid}`) ===
      '0',
  );
  await page.screenshot({ path: `${SHOTS}/cp57-pet-zero-balance.png` });

  // Flashcard: marking a card persists progress across a reload.
  await hidePet(page);
  await page.goto(`${FE}/flashcard/1`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
  await page
    .getByRole('button', { name: /Đã thuộc/ })
    .first()
    .click();
  await page.waitForTimeout(2000);
  const progress = Number(
    one(`select count(*) from "UserVocabWordProgress" where "userId" = ${uid}`),
  );
  check(
    'Flashcard: "Đã thuộc" writes progress',
    progress >= 1,
    `(${progress} rows)`,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check(
    'Flashcard: progress survives a reload',
    Number(
      one(
        `select count(*) from "UserVocabWordProgress" where "userId" = ${uid}`,
      ),
    ) >= progress,
  );
  check(
    'Flashcard: no XP or Bread for studying',
    one(
      `select coalesce(sum(points),0) from "PointHistory" where "userId" = ${uid}`,
    ) === '0',
  );

  // Writing: one task of the five-task A2 exercise, through the UI.
  await page.goto(`${FE}/writing/17`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
  await page
    .locator('textarea')
    .first()
    .fill(
      'Hi Alex, I am sorry that I will arrive late tomorrow. My train is delayed, so I will come at ten instead of nine. Please start the meeting without me and I will join as soon as I can. Best, Minh',
    );
  await page.getByRole('button', { name: /Gửi đánh giá bài viết/ }).click();
  await page.waitForTimeout(6000);
  const after = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const stored = one(
    `select count(*) from "Submission" where "userId" = ${uid} and "quizId" = 17`,
  );
  check('Writing: the submitted task is stored', stored === '1', `(${stored})`);
  check(
    'Writing: the result shows a score and feedback, no raw error',
    /điểm|Điểm/.test(after) &&
      !/Request failed|undefined|Exception/.test(after),
    after.slice(0, 160),
  );
  await page.screenshot({
    path: `${SHOTS}/cp57-writing-task1-result.png`,
    fullPage: true,
  });
  await page.goto(`${FE}/writing`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);
  const card = page
    .locator('a, article, div', {
      hasText: 'Writing A2 — Messages & Simple Emails',
    })
    .last();
  const cardText = (await card.innerText().catch(() => '')).replace(
    /\s+/g,
    ' ',
  );
  check(
    'Writing catalog: one task of five is not shown as completed',
    !/Đã hoàn thành|Hoàn thành/.test(cardText),
    cardText.slice(0, 120),
  );

  // Logout ends the session; protected pages send the learner to login.
  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  await page
    .getByRole('menuitem', { name: /Đăng xuất/ })
    .or(page.getByRole('button', { name: /Đăng xuất/ }))
    .first()
    .click();
  await page.waitForTimeout(2500);
  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);
  check(
    'Logout: /dashboard redirects to login',
    page.url().includes('/login'),
    page.url(),
  );

  check(
    'no server errors during the journeys',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api')).join(' | '),
  );
  await browser.close();
  console.log(`CP57_JOURNEY_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
