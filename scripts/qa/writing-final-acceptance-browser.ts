/**
 * Writing Practice final acceptance in Chromium on the disposable harness:
 * FE :3100 → BE :3101 (scripts/qa/writing-deterministic-server.ts, no
 * provider), DB harness-pg/HARNESS_DB (a clone carrying the v2 content),
 * Redis harness-redis :6392. Synthetic learners only.
 *
 * Usage: HARNESS_DB=writing_e2e WRITING_QA_COUNTER_FILE=<file> \
 *   npx ts-node --transpile-only scripts/qa/writing-final-acceptance-browser.ts
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { call, check, failureCount, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';
import { FE, hidePet, studentPage } from './harness-browser';

const QUIZ = 17;
const counterFile = process.env.WRITING_QA_COUNTER_FILE;
const graderCalls = () =>
  Number(JSON.parse(readFileSync(String(counterFile), 'utf8')).calls);
const words = (n: number, w = 'study') => Array.from({ length: n }, () => w).join(' ');
const valid50 =
  "Hello, I'm trying to open the vocabulary review file for Lesson 4, but the link does not work on my phone or my laptop. I only see an error page. Could you please check the file or send me another link? Thank you very much for your help. Best regards, Minh";

async function main() {
  const { browser, page, account, issues } = await studentPage('wr-final', 1366);
  await hidePet(page);
  const leaks: string[] = [];
  page.on('response', async (r) => {
    if (!r.url().startsWith('http://localhost:3101')) return;
    const body = await r.text().catch(() => '');
    if (/sampleResponse|sceneDescription|Dear Ms\. Ha/.test(body))
      leaks.push(r.url().slice(21));
  });
  const subs = (questionId: number) =>
    harnessQuery(
      `select s.id, s.score, s."clientAttemptId" from "Submission" s join "Result" r on r."submissionId" = s.id where s."userId" = ${account.userId} and r."questionId" = ${questionId} order by s.id`,
    );
  const openTask = async (q: number) => {
    await page.goto(`${FE}/writing/${QUIZ}?q=${q}`, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.locator('textarea').first().waitFor({ timeout: 60_000 });
  };
  const submitText = async (text: string) => {
    await page.locator('textarea').first().fill(text);
    await page.getByRole('button', { name: /Gửi đánh giá bài viết/ }).click();
  };

  // A. catalog
  await page.goto(`${FE}/writing`, { waitUntil: 'networkidle', timeout: 120_000 });
  const listed = await page
    .getByText(/tin nhắn và email ngắn/i)
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check('A catalog lists the A2 messages exercise', listed);

  // B-D. updated prompt and word-count requirement (v2 content of Q84)
  await openTask(84);
  const body = await page.locator('body').innerText();
  check('B/C exercise shows the v2 prompt (bộ phận hỗ trợ)', /bộ phận hỗ trợ của khoá học/.test(body));
  check('D word range shown (40–60)', /40\s*[–-]\s*60/.test(body));

  // E-I. valid answer, one submit, pending state, result with rubric and Vietnamese feedback
  const before = graderCalls();
  await page.locator('textarea').first().fill(valid50);
  const button = page.getByRole('button', { name: /Gửi đánh giá bài viết/ });
  await button.dblclick();
  await page.waitForURL(/\/writing\/submissions\/\d+/, { timeout: 90_000 });
  check('F double-click grades once', graderCalls() === before + 1, `calls ${graderCalls() - before}`);
  check('F one stored submission', subs(84).length === 1);
  await page.waitForLoadState('networkidle');
  const result = await page.locator('body').innerText();
  check('H final score shown', /\b9\s*\/\s*10\b|9\/10|90/.test(result), result.match(/\d+\s*\/\s*10/)?.[0] ?? 'none');
  check('I Vietnamese feedback shown', /Nhận xét tất định/.test(result));

  // J-K. off-topic answer: capped at 4/10 with an explanation
  await openTask(85);
  await submitText(`${words(52, 'picnic')} [[offtopic]]`);
  await page.waitForURL(/\/writing\/submissions\/\d+/, { timeout: 90_000 });
  const off = subs(85);
  check('K off-topic stored score is 4', off.length === 1 && Number(off[0][1]) === 4, JSON.stringify(off));
  await page.waitForLoadState('networkidle');
  check('J off-topic explanation shown', /chưa đúng yêu cầu của đề/.test(await page.locator('body').innerText()));

  // L-M. far too short: the UI blocks it before any grading; the API path is capped at 5/10
  await openTask(81);
  const callsBeforeShort = graderCalls();
  await submitText('Sorry, I am late. My bus is slow. See you soon.');
  await page.waitForTimeout(1500);
  check('L UI refuses an answer under the minimum (no grading)', graderCalls() === callsBeforeShort && subs(81).length === 0);
  const short = await call('POST', `/writing/quizzes/${QUIZ}/submit`, account.token, {
    answer: 'Sorry, I am late. My bus is slow. See you soon.',
    clientAttemptId: randomUUID(),
    questionId: 81,
  });
  check('M API: FAR_BELOW capped at 5/10', short.data?.score === 5 && short.data?.scoreAdjustment?.reason === 'TOO_SHORT', JSON.stringify({ s: short.data?.score, adj: short.data?.scoreAdjustment }));

  // N-O. refresh during an in-flight grading, then resubmit the same text
  await openTask(83);
  const slow = `${words(54, 'join')} [[delay:6000]]`;
  const callsBeforeSlow = graderCalls();
  await page.locator('textarea').first().fill(slow);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Gửi đánh giá bài viết/ }).click();
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(8000);
  check('N the in-flight grading finished server-side and was stored once', subs(83).length === 1 && graderCalls() === callsBeforeSlow + 1);
  const restored = await page.locator('textarea').first().inputValue();
  check('O the text is still in the editor after refresh', restored.trim() === slow.trim(), `len ${restored.length}`);
  await page.getByRole('button', { name: /Gửi đánh giá bài viết/ }).click();
  await page.waitForURL(/\/writing\/submissions\/\d+/, { timeout: 90_000 });
  check('O resubmitting the same text returns the stored grade (no new grading, no new row)', subs(83).length === 1 && graderCalls() === callsBeforeSlow + 1, `rows ${subs(83).length} calls ${graderCalls() - callsBeforeSlow}`);

  // P-Q. provider failure: error shown, text kept, retry succeeds
  await openTask(82);
  const failing = `${words(55, 'hotel')} [[fail]]`;
  await submitText(failing);
  await page.getByText(/Chưa chấm được bài/).first().waitFor({ timeout: 60_000 });
  check('P failure message shown and nothing stored', subs(82).length === 0);
  check('Q text kept after failure', (await page.locator('textarea').first().inputValue()).trim() === failing.trim());
  await submitText(words(55, 'hotel'));
  await page.waitForURL(/\/writing\/submissions\/\d+/, { timeout: 90_000 });
  check('Q retry is graded and stored once', subs(82).length === 1);

  // R. personal history: own submission review page opens
  const ownId = Number(subs(84)[0][0]);
  await page.goto(`${FE}/writing/submissions/${ownId}`, { waitUntil: 'networkidle' });
  check('R own submission review opens', /Nhận xét tất định|Bài viết/.test(await page.locator('body').innerText()));

  // S. no reference answer, scene text or rubric in any response to the browser
  check('S no reference answer in learner responses', leaks.length === 0, leaks.slice(0, 3).join(' '));

  // T. privacy: anonymous 401; another learner cannot read this learner's submission or list
  check('T anonymous community 401', (await call('GET', `/writing/quizzes/${QUIZ}/community`)).status === 401);
  const other = await newStudent('wr-other');
  const peek = await call('GET', `/quizzes/submissions/${ownId}/analytics`, other.token);
  check('T other learner cannot open the submission', peek.status === 403, `status ${peek.status}`);
  const list = await call('GET', `/writing/quizzes/${QUIZ}/community`, other.token);
  check('T other learner sees none of these submissions', Array.isArray(list.data) && list.data.length === 0);

  check('no page errors or 5xx besides the planned failure', issues.filter((i) => !/503/.test(i)).length === 0, issues.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`WRITING_FINAL_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
