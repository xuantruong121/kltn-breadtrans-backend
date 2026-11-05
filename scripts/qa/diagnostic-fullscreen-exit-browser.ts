/**
 * The entry diagnostic enters fullscreen when the learner starts and must
 * leave it once the result is on screen. Disposable harness only.
 *
 * The learner answers the objective items, skips Speaking and Writing,
 * submits, and the result page is checked for fullscreen at each step; then
 * the result is reloaded and checked again.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/diagnostic-fullscreen-exit-browser.ts
 */
import { mkdirSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/diag-fullscreen`;
const norm = (t: string) =>
  t
    .replace(/^\d+\.\s*/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const optionsOf = (raw: any): string[] =>
  Array.isArray(raw) ? raw : Array.isArray(raw?.values) ? raw.values : [];

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const assessmentId = Number(
    harnessQuery(
      `select id from "DiagnosticAssessment" where "isActive" order by id desc limit 1`,
    )[0]?.[0],
  );
  const bank = new Map(
    harnessQuery(
      `select question, options::text, "correctIndex", "taskType" from "DiagnosticQuestion" where "assessmentId" = ${assessmentId}`,
    ).map(([q, o, k, t]) => [
      norm(q),
      { options: optionsOf(JSON.parse(o)), key: Number(k), taskType: t },
    ]),
  );
  // RECORD=1: record Speaking with Chromium's fake microphone and write the
  // Writing tasks, as a learner does, instead of skipping them.
  const record = process.env.RECORD === '1';
  const { browser, page } = await studentPage(
    'diag-fullscreen',
    1366,
    false,
    record
      ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
      : [],
  );
  const fullscreen = () =>
    page.evaluate(() => document.fullscreenElement !== null);

  await page.goto(`${FE}/diagnostic`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await hidePet(page);
  await page.getByRole('button', { name: /Bắt đầu làm bài/ }).click();
  await page.waitForTimeout(2500);
  check('starting the test enters fullscreen', await fullscreen());

  // Leaving fullscreen during the test (Esc, a browser prompt) shows a way back.
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(800);
  const back = page.getByRole('button', { name: 'Bật lại toàn màn hình' });
  check(
    'leaving fullscreen mid-test shows "Bật lại toàn màn hình"',
    await back.isVisible(),
  );
  await back.click();
  await page.waitForTimeout(800);
  check('the button puts the test back in fullscreen', await fullscreen());
  check('the banner goes away in fullscreen', !(await back.isVisible()));

  for (let i = 0; i < bank.size; i += 1) {
    const prompts = await page.locator('h2').allInnerTexts();
    const item = prompts
      .map(norm)
      .map((t) => bank.get(t))
      .find(Boolean);
    if (!item) break;
    if (record && item.taskType === 'SPEAKING_RESPONSE') {
      await page.getByRole('button', { name: /^(Ghi âm|Ghi lại)$/ }).click();
      await page.getByText(/Đang ghi âm/).waitFor({ timeout: 15_000 });
      await page.waitForTimeout(3000);
      await page.getByRole('button', { name: /Dừng ghi âm/ }).click();
      await page.waitForTimeout(6000);
      check(
        `speaking ${i + 1}: still in fullscreen after recording`,
        await fullscreen(),
      );
      const next = page.getByRole('button', { name: /^Câu tiếp/ });
      if (
        (await next.isVisible().catch(() => false)) &&
        (await next.isEnabled().catch(() => false))
      )
        await next.click();
      await page.waitForTimeout(500);
      continue;
    }
    if (record && item.taskType === 'WRITING_RESPONSE') {
      await page
        .getByLabel('Câu trả lời tự luận')
        .fill(
          Array.from(
            { length: 70 },
            (_, k) =>
              ['I', 'think', 'our', 'team', 'should', 'meet', 'on', 'Friday'][
                k % 8
              ],
          ).join(' '),
        );
      const next = page.getByRole('button', { name: /^(Câu tiếp|Hoàn thành)/ });
      if ((await next.innerText()).startsWith('Câu tiếp')) await next.click();
      await page.waitForTimeout(500);
      continue;
    }
    if (
      item.taskType === 'SPEAKING_RESPONSE' ||
      item.taskType === 'WRITING_RESPONSE'
    ) {
      await page.getByRole('button', { name: /^Bỏ qua$/ }).click();
      await page.waitForTimeout(500);
      continue;
    }
    await page
      .getByRole('button')
      .filter({ hasText: item.options[item.key] })
      .first()
      .click();
    await page.waitForTimeout(500);
    const next = page.getByRole('button', { name: /^Câu tiếp/ });
    if (
      (await next.isVisible().catch(() => false)) &&
      (await next.isEnabled().catch(() => false))
    ) {
      await next.click();
      await page.waitForTimeout(300);
    }
  }
  check('still in fullscreen just before submitting', await fullscreen());

  await page.getByRole('button', { name: /Hoàn thành & nộp bài/ }).click();
  const confirm = page.getByRole('button', { name: /Vẫn nộp bài/ });
  if (await confirm.isVisible({ timeout: 3000 }).catch(() => false))
    await confirm.click();
  await page
    .getByText(/Kết quả đánh giá đầu vào|Mức luyện tập đề xuất|Đang chấm/)
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  check('the result page has left fullscreen', !(await fullscreen()));
  await page.screenshot({ path: `${SHOTS}/after-submit.png` });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  check(
    'after a reload the result is not in fullscreen',
    !(await fullscreen()),
  );
  await browser.close();

  console.log(`\nDIAG_FULLSCREEN_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
