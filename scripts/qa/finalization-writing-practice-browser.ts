/**
 * Writing practice grading on the disposable harness.
 *
 *   fail : harness WITHOUT provider keys. A submit must be refused and leave
 *          no Submission, no score, no XP.
 *   real : harness started with HARNESS_REAL_GRADER=1 (Gemini free tier).
 *          Chromium submits two answers on /writing/[id]: one sentence with a
 *          single known error and one clean short message. Each costs one
 *          Gemini request (two if the first reply is rejected by validation).
 *
 * Usage: npx ts-node scripts/qa/finalization-writing-practice-browser.ts fail|real
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import { call, check, failureCount, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';
import { FE, hidePet, studentPage } from './harness-browser';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots`;
const SENTENCE_QUIZ = 3; // SENTENCE: use "meeting" and "tomorrow"
const MESSAGE_QUIZ = 17; // SHORT_MESSAGE, 40-60 words
const WITH_ERROR =
  'My manager ask me to prepare the slides for the meeting tomorrow.';
const CLEAN =
  'Hi everyone, I am sorry I arrived fifteen minutes late to our study session today. My bus broke down on the way, and I could not call because my phone battery was empty. Next time I will leave home earlier. Could someone share the notes I missed? Thank you.';

const rows = (userId: number) => ({
  submissions: harnessQuery(
    `select id, "quizId", score, "aiFeedback" from "Submission" where "userId" = ${userId} order by id`,
  ),
  xp: harnessQuery(
    `select reason, points from "PointHistory" where "userId" = ${userId} order by id`,
  ),
});

async function fail() {
  const s = await newStudent('wr-fail');
  const r = await call(
    'POST',
    `/writing/quizzes/${SENTENCE_QUIZ}/submit`,
    s.token,
    { answer: WITH_ERROR, clientAttemptId: randomUUID() },
  );
  check(
    'without a grader the submit is refused (5xx)',
    r.status >= 500,
    `${r.status} ${JSON.stringify(r.message)}`,
  );
  const after = rows(s.userId);
  check(
    'no Submission, score or XP is stored for a refused grade',
    after.submissions.length === 0 && after.xp.length === 0,
    JSON.stringify(after),
  );
}

async function submitInBrowser(
  page: import('playwright').Page,
  quizId: number,
  answer: string,
  shot: string,
) {
  await page.goto(`${FE}/writing/${quizId}`);
  await hidePet(page);
  const box = page.locator('textarea').first();
  await box.waitFor({ timeout: 30_000 });
  await box.fill(answer);
  await page
    .getByRole('button', { name: /Gửi đánh giá bài viết/ })
    .first()
    .click();
  await page.getByText('Điểm theo tiêu chí').waitFor({ timeout: 90_000 });
  await page.screenshot({ path: `${SHOTS}/${shot}`, fullPage: true });
  return page.locator('body').innerText();
}

async function real() {
  const { browser, page, account } = await studentPage('wr-real', 1366);
  const before = rows(account.userId);

  const body1 = await submitInBrowser(
    page,
    SENTENCE_QUIZ,
    WITH_ERROR,
    'writing-3-result.png',
  );
  const s1 = rows(account.userId).submissions.at(-1)!;
  const fb1 = JSON.parse(s1[3]);
  console.log('      quiz 3 feedback', JSON.stringify(fb1, null, 2));
  check(
    'quiz 3 graded with its own rubric (max 10)',
    fb1.rubricVersion === 'PRACTICE_WRITING_V1' && fb1.maxScore === 10,
  );
  check(
    'the known error is corrected with a quote of the learner text',
    fb1.corrections.some(
      (c: { original: string; corrected: string }) =>
        /\bask\b/.test(c.original) && /\basks\b|\basked\b/.test(c.corrected),
    ),
    JSON.stringify(fb1.corrections),
  );
  check(
    'keywords checked deterministically',
    fb1.keywords.every((k: { present: boolean }) => k.present),
  );
  check(
    'page shows criteria and the correction',
    body1.includes('Điểm theo tiêu chí') &&
      body1.includes('Lỗi cần sửa trong bài của bạn'),
  );

  const body2 = await submitInBrowser(
    page,
    MESSAGE_QUIZ,
    CLEAN,
    'writing-17-result.png',
  );
  const s2 = rows(account.userId).submissions.at(-1)!;
  const fb2 = JSON.parse(s2[3]);
  console.log('      quiz 17 feedback', JSON.stringify(fb2, null, 2));
  check(
    'quiz 17 graded with its own rubric (max 10)',
    fb2.rubricVersion === 'PRACTICE_WRITING_V1' && fb2.maxScore === 10,
  );
  check(
    'word count computed from the text',
    fb2.wordCount === CLEAN.trim().split(/\s+/).length,
    String(fb2.wordCount),
  );
  check('page shows the result', body2.includes('Điểm theo tiêu chí'));

  // Persistence after refresh: the saved result page.
  await page.goto(`${FE}/writing/submissions/${s1[0]}`);
  await page.getByText('Điểm theo tiêu chí').waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: `${SHOTS}/writing-3-saved.png`,
    fullPage: true,
  });
  const saved = await page.locator('body').innerText();
  check(
    'saved result shows the same score and correction',
    saved.includes(`${s1[2]}`) &&
      saved.includes(fb1.corrections[0]?.corrected ?? '@@'),
  );

  const after = rows(account.userId);
  check(
    'one Submission per answer',
    after.submissions.length - before.submissions.length === 2,
  );
  console.log('      XP rows', JSON.stringify(after.xp));

  // Duplicate clientAttemptId: same submission back, no second grade.
  const id = randomUUID();
  const first = await call(
    'POST',
    `/writing/quizzes/${SENTENCE_QUIZ}/submit`,
    account.token,
    { answer: WITH_ERROR, clientAttemptId: id },
  );
  const dup = await call(
    'POST',
    `/writing/quizzes/${SENTENCE_QUIZ}/submit`,
    account.token,
    { answer: WITH_ERROR, clientAttemptId: id },
  );
  check(
    'duplicate clientAttemptId returns the stored submission',
    first.status < 300 && dup.data?.submissionId === first.data?.submissionId,
    `${first.status} ${first.data?.submissionId} ${dup.data?.submissionId}`,
  );
  const xpAfterDup = rows(account.userId).xp.length;
  console.log('      XP rows after 3rd answer + duplicate', xpAfterDup);
  await browser.close();
}

void (async () => {
  mkdirSync(SHOTS, { recursive: true });
  if (process.argv[2] === 'fail') await fail();
  else await real();
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
})();
