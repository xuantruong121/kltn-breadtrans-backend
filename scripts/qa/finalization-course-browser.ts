/**
 * Course journey in a real browser on the disposable harness: PRO learner
 * opens a course, starts it, opens the first lesson, answers the first
 * exercise (objective items from the clone's keys, free text in own words)
 * and sees the result.
 */
import { check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

async function main() {
  console.log('\n== Course journey (browser)');
  const { browser, page, account, issues } = await studentPage(
    'course-ui',
    1366,
    true,
  );
  await page.goto(`${FE}/courses/1`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.getByRole('button', { name: /Bắt đầu \/ tiếp tục/ }).click();
  await page
    .waitForURL(/\/my-courses\/1$/, { timeout: 60_000 })
    .catch(() => undefined);
  check(
    'starting course 1 opens the learning path',
    /\/my-courses\/1$/.test(page.url()),
    `(${page.url().slice(21)})`,
  );

  await page.waitForLoadState('networkidle');
  await page.locator('a[href*="/my-courses/1/lessons/"]').first().click();
  await page
    .waitForURL(/\/my-courses\/1\/lessons\/\d+/, { timeout: 60_000 })
    .catch(() => undefined);
  const lessonId = Number(/lessons\/(\d+)/.exec(page.url())?.[1]);
  check('the first lesson opens', !!lessonId, `(${page.url().slice(21)})`);
  await page.waitForLoadState('networkidle');

  const [exerciseId] = harnessQuery(
    `select id from "CourseLessonExercise" where "lessonId" = ${lessonId} and required order by "order" limit 1`,
  )[0];
  const questions = harnessQuery(
    `select id, options::text, "correctAnswer"::text, prompt from "CourseLessonQuestion" where "exerciseId" = ${exerciseId} order by "order"`,
  ).map(([id, options, key, prompt]) => ({
    id: Number(id),
    options: JSON.parse(options),
    key: JSON.parse(key),
    prompt,
  }));
  // The innermost section holding this exercise's first prompt and its own submit button.
  const section = page
    .locator('section')
    .filter({ hasText: questions[0].prompt })
    .filter({ has: page.getByRole('button', { name: 'Nộp bài' }) })
    .last();
  let open = 0;
  for (const q of questions) {
    if (Array.isArray(q.options) && q.options.length > 0) {
      await section
        .getByRole('button', { name: String(q.key), exact: true })
        .first()
        .click();
    } else {
      await section
        .locator('textarea')
        .nth(open)
        .fill('I come from Can Tho and I study English.');
      open += 1;
    }
  }
  await section.getByRole('button', { name: 'Nộp bài' }).click();
  await page.waitForTimeout(3000);
  const text = (await section.innerText()).replace(/\s+/g, ' ');
  const objective = questions.length - open;
  check(
    'result shows the objective score',
    text.includes(`${objective}/${objective} câu trắc nghiệm đúng`),
    `(${objective} objective)`,
  );
  check(
    'free-text answers are shown with a model answer, not marked wrong',
    open === 0 ||
      (text.includes('Câu tự viết') && text.includes('Câu tham khảo')),
  );
  const [row] = harnessQuery(
    `select a.score, a."maxScore" from "CourseLessonAttempt" a join "User" u on u.id = a."userId" where u.email = '${account.email}' and a."exerciseId" = ${exerciseId} order by a.id desc limit 1`,
  );
  check(
    'the attempt is stored with the objective score',
    row?.[0] === String(objective) && row?.[1] === String(objective),
    `(${row?.join('/')})`,
  );
  await page.screenshot({
    path: 'artifacts/finalization/evidence/course-exercise-result.png',
    fullPage: true,
  });
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api 5')).join(' | '),
  );
  await browser.close();
  console.log(`\nCOURSE_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
