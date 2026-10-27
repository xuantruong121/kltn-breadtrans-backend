/**
 * Course Learning journeys in real Chromium on the disposable harness.
 *
 *  - FREE learner: course detail shows the PRO gate, cannot start.
 *  - PRO learner, course 8 (had a legacy outline): detail lists the lessons
 *    actually studied; start, open lesson 1, complete both exercises in the
 *    UI, reload and keep progress, a failed exercise in lesson 2 says so,
 *    resume from the learning path.
 *  - PRO learner, course 12: every lesson completed in the UI via
 *    "Bài tiếp theo"; the learning path ends at 8/8 · 100%.
 *  - Mobile (390px): lesson page has no horizontal overflow.
 *  - Persisted XP / Bread / Bread ledger / quest deltas stay 0.
 */
import type { Page } from 'playwright';

import { check, failureCount } from './harness-api';
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

const questionsOf = (exerciseId: number) =>
  harnessQuery(
    `select id, options::text, "correctAnswer"::text, prompt from "CourseLessonQuestion" where "exerciseId" = ${exerciseId} order by "order"`,
  ).map(([id, options, key, prompt]) => ({
    id: Number(id),
    options: JSON.parse(options) as unknown[] | null,
    key: JSON.parse(key) as unknown,
    prompt,
  }));

/** Answer one exercise card in the UI and submit it; returns the card's text afterwards. */
async function answerExercise(page: Page, exerciseId: number, wrong = false) {
  const questions = questionsOf(exerciseId);
  // Blanks (___) render as an empty slot, so find the card by its title.
  const [[title]] = harnessQuery(
    `select title from "CourseLessonExercise" where id = ${exerciseId}`,
  );
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Nộp bài' }) })
    .last();
  // One block per question, in order; scoping to it avoids clicking an
  // identical option label that belongs to another question of the card.
  const blocks = card.locator(':scope > div.mt-6.space-y-6 > div');
  for (const [i, q] of questions.entries()) {
    const block = blocks.nth(i);
    if (Array.isArray(q.options) && q.options.length > 0) {
      const choice = wrong ? q.options.find((o) => o !== q.key) : q.key;
      await block
        .getByRole('button', { name: String(choice), exact: true })
        .click();
    } else {
      await block
        .locator('textarea')
        .fill('In my own words, this is my answer.');
    }
  }
  await card.getByRole('button', { name: 'Nộp bài' }).click();
  try {
    await card
      .getByText(/Hoàn thành bài tập|Chưa đạt bài tập này/)
      .waitFor({ timeout: 30_000 });
  } catch {
    const text = (await card.innerText()).replace(/\s+/g, ' ');
    throw new Error(
      `exercise ${exerciseId}: no result shown. Card: ${text.slice(-400)}`,
    );
  }
  return (await card.innerText()).replace(/\s+/g, ' ');
}

const exercisesOf = (lessonId: number) =>
  harnessQuery(
    `select id from "CourseLessonExercise" where "lessonId" = ${lessonId} order by "order"`,
  ).map(([id]) => Number(id));

async function pathText(page: Page, courseId: number) {
  await page.goto(`${FE}/my-courses/${courseId}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page
    .getByText(/\d+\/\d+ bài/)
    .first()
    .waitFor({ timeout: 30_000 });
  return (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
}

async function main() {
  console.log('\n== FREE learner meets the PRO gate (browser)');
  {
    const { browser, page, issues } = await studentPage(
      'course-free-ui',
      1366,
      false,
    );
    await page.goto(`${FE}/courses/8`, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
    const startBtn = page.getByRole('button', { name: /Cần gói PRO/ });
    check(
      'course 8 shows "Cần gói PRO" and the start button is disabled',
      await startBtn.isDisabled(),
    );
    check(
      'an upgrade link to the PRO plan is offered',
      (await page.locator('a[href*="/plans"]').count()) > 0,
    );
    await page.screenshot({
      path: `${SHOTS}/course-free-locked.png`,
      fullPage: true,
    });
    await page.goto(`${FE}/my-courses/8/lessons/17`, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check(
      'opening a lesson URL directly as FREE shows no lesson content',
      !/bài tập 1/i.test(body) && !body.includes('Nộp bài'),
      `(${body.slice(0, 140)})`,
    );
    check(
      'no server error (FREE)',
      !issues.some((x) => x.startsWith('api 5')),
      issues.join(' | '),
    );
    await browser.close();
  }

  console.log(
    '\n== PRO learner, course 8: start, complete lesson 1, reload, fail and resume',
  );
  const { browser, page, account, issues } = await studentPage(
    'course-pro-ui',
    1366,
    true,
  );
  await hidePet(page);
  const before = balance(account.userId);
  await page.goto(`${FE}/courses/8`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  const detail = (await page.locator('main').first().innerText()).replace(
    /\s+/g,
    ' ',
  );
  check(
    'course 8 detail lists the studied lessons, not the legacy outline',
    detail.includes('Thì hiện tại đơn') &&
      !detail.includes('Passive Voice') &&
      !detail.includes('chưa có hoạt động'),
  );
  check(
    'course 8 detail counts 8 lessons and 16 activities',
    detail.includes('8 bài học · 16 hoạt động'),
  );
  await page.screenshot({
    path: `${SHOTS}/course-8-detail.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: /Bắt đầu \/ tiếp tục/ }).click();
  await page.waitForURL(/\/my-courses\/8$/, { timeout: 60_000 });
  check('start opens the learning path', true);

  await page.goto(`${FE}/my-courses/8/lessons/17`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  const lessonText = (await page.locator('main').first().innerText()).replace(
    /\s+/g,
    ' ',
  );
  check(
    'lesson 1 renders its sections and exercises',
    /bài tập 1/i.test(lessonText) && lessonText.length > 1500,
    `(${lessonText.length} chars)`,
  );
  for (const exerciseId of exercisesOf(17)) {
    const text = await answerExercise(page, exerciseId);
    check(
      `exercise ${exerciseId}: UI reports "Hoàn thành bài tập"`,
      text.includes('Hoàn thành bài tập'),
    );
  }
  await page.screenshot({
    path: `${SHOTS}/course-8-lesson-1-done.png`,
    fullPage: true,
  });
  await page.reload({ waitUntil: 'networkidle' });
  let path = await pathText(page, 8);
  check(
    'after reload the learning path keeps lesson 1 completed (1/8 · 13%)',
    path.includes('1/8 bài') && path.includes('13%'),
  );

  await page.goto(`${FE}/my-courses/8/lessons/17`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.getByRole('link', { name: /Bài tiếp theo/ }).click();
  await page.waitForURL(/\/my-courses\/8\/lessons\/18/, { timeout: 60_000 });
  check('"Bài tiếp theo" opens lesson 2', true);
  const [firstOfLesson2] = exercisesOf(18);
  const failed = await answerExercise(page, firstOfLesson2, true);
  check(
    'a wrong answer says "Chưa đạt bài tập này", not completed',
    failed.includes('Chưa đạt bài tập này') &&
      !failed.includes('Hoàn thành bài tập'),
  );
  await page.screenshot({
    path: `${SHOTS}/course-8-lesson-2-failed.png`,
    fullPage: true,
  });

  path = await pathText(page, 8);
  check(
    'learning path: lesson 2 not completed, progress unchanged (1/8)',
    path.includes('1/8 bài'),
  );
  await page.getByRole('link', { name: 'Học tiếp bài học' }).click();
  await page.waitForURL(/\/my-courses\/8\/lessons\/18/, { timeout: 60_000 });
  check(
    '"Học tiếp bài học" resumes at the first unfinished lesson (lesson 2)',
    true,
  );

  console.log('\n== PRO learner completes course 12 entirely in the UI');
  await page.goto(`${FE}/my-courses/12/lessons/1`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  let walked = 0;
  for (;;) {
    const lessonId = Number(/lessons\/(\d+)/.exec(page.url())?.[1]);
    for (const exerciseId of exercisesOf(lessonId)) {
      const text = await answerExercise(page, exerciseId);
      if (!text.includes('Hoàn thành bài tập'))
        check(`course 12 exercise ${exerciseId} completes in the UI`, false);
    }
    walked += 1;
    const next = page.getByRole('link', { name: /Bài tiếp theo/ });
    if ((await next.count()) === 0) break;
    await next.click();
    await page.waitForURL((u) => !u.pathname.endsWith(`/lessons/${lessonId}`), {
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle');
  }
  path = await pathText(page, 12);
  check(
    `course 12: ${walked} lessons completed in the UI; path shows 8/8 · 100%`,
    walked === 8 && path.includes('8/8 bài') && path.includes('100%'),
  );
  await page.screenshot({
    path: `${SHOTS}/course-12-complete.png`,
    fullPage: true,
  });
  await page.reload({ waitUntil: 'networkidle' });
  path = await pathText(page, 12);
  check(
    'course 12 completion survives a reload',
    path.includes('8/8 bài') && path.includes('100%'),
  );

  await new Promise((ok) => setTimeout(ok, 2500));
  const after = balance(account.userId);
  const delta = after.map((v, i) => v - before[i]);
  check(
    'browser course journey: XP 0, Bread 0, Bread ledger 0, quest 0',
    delta.every((v) => v === 0),
    `(${delta.join(',')})`,
  );
  check(
    'no server error (PRO)',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api')).join(' | '),
  );
  await browser.close();

  console.log('\n== Mobile lesson page (390px)');
  {
    const m = await studentPage('course-mobile-ui', 390, true);
    await hidePet(m.page);
    await m.page.goto(`${FE}/my-courses/1/lessons/9`, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
    const overflow = await m.page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    check(
      'lesson page at 390px has no horizontal overflow',
      overflow <= 1,
      `(${overflow}px)`,
    );
    const [first] = exercisesOf(9);
    const text = await answerExercise(m.page, first);
    check(
      'an exercise can be completed at 390px',
      text.includes('Hoàn thành bài tập'),
    );
    await m.page.screenshot({
      path: `${SHOTS}/course-1-lesson-mobile.png`,
      fullPage: true,
    });
    await m.browser.close();
  }

  console.log(`\nCOURSE_JOURNEY_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
