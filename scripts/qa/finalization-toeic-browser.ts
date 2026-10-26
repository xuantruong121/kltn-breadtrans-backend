/**
 * TOEIC L&R in a real browser, disposable harness. Listening advances with
 * the audio, so the full 200 questions are not clicked through headless: the
 * learner starts the test in the UI and answers Q1 (autosave), the same
 * account submits through the API, then the result and review pages are
 * checked in the browser against the stored attempt.
 */
import { call, check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

async function main() {
  console.log('\n== TOEIC L&R (browser)');
  const { browser, page, account, issues } = await studentPage('toeic-ui');
  const saves: number[] = [];
  page.on('response', (r) => {
    if (/\/toeic\/attempts\/\d+\/answers$/.test(r.url()))
      saves.push(r.status());
  });
  await page.goto(`${FE}/exams/2`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  const text0 = await page.locator('body').innerText();
  check(
    'detail page states the test is not an official ETS test',
    /không phải đề thi chính thức/i.test(text0),
  );
  await page.getByRole('button', { name: /Bắt đầu làm bài/ }).click();
  await page.waitForURL(/\/toeic\/attempts\/\d+/, { timeout: 60_000 });
  const attemptId = Number(/attempts\/(\d+)/.exec(page.url())?.[1]);
  check(
    'the exam room opens on a new attempt',
    !!attemptId,
    `(${page.url().slice(21)})`,
  );
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /^A\./ }).first().click();
  await page.waitForTimeout(4000);
  const [saved] = harnessQuery(
    `select count(*) from "ToeicAttemptAnswer" where "attemptId" = ${attemptId}`,
  )[0];
  check(
    'choosing an answer is autosaved to the server',
    saves.some((s) => s < 300) && Number(saved) >= 1,
    `(saves ${saves.join(',')}, rows ${saved})`,
  );

  const submit = await call(
    'POST',
    `/toeic/attempts/${attemptId}/submit`,
    account.token,
    {},
  );
  check(
    'submit (same learner)',
    submit.status < 300,
    `(status ${submit.status})`,
  );
  await page.goto(`${FE}/toeic/results/${attemptId}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.waitForTimeout(2000);
  const result = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the result page shows the stored correct counts',
    result.includes(`${submit.data.listeningCorrect}/100`) &&
      result.includes(`${submit.data.readingCorrect}/100`) &&
      result.includes(`${submit.data.totalCorrect}/200`),
    `(L${submit.data.listeningCorrect} R${submit.data.readingCorrect} T${submit.data.totalCorrect})`,
  );
  check(
    'the result page says it is practice, not an official ETS score',
    /không phải điểm thi chính thức/i.test(result),
  );
  await page.screenshot({
    path: 'artifacts/finalization/evidence/toeic-result.png',
    fullPage: true,
  });
  await page.goto(`${FE}/toeic/review/${attemptId}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.waitForTimeout(2000);
  const review = await page.locator('body').innerText();
  check(
    'the review page opens with explanations',
    review.length > 500 && !/Không thể/i.test(review.slice(0, 400)),
  );
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api 5')).join(' | '),
  );
  await browser.close();
  console.log(`\nTOEIC_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
