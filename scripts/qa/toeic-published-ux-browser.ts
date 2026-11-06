/**
 * UX walk of the three published TOEIC tests on the disposable harness
 * (FE :3100, BE :3101 on a clone of kltn_db). Read-mostly: it creates harness
 * accounts and attempts only.
 *
 *   L&R Đề 01 (/exams/2): start screen; Practice by Part 3+4+7 (three-speaker
 *     group, graphic groups, double and triple passages); submit; result and
 *     review; Full Test Part 1/2; the same practice at 390 px.
 *   S&W Đề 01 (/exams/3): Speaking tabs (read aloud, picture, Q5-7, Q8-10
 *     stimulus, Q11) and Writing tabs (pictures, e-mail tasks, essay).
 *   4 Skills Đề 02 (/exams/5): L&R graphic in the room, then Speaking and
 *     Writing after the L&R hand-over.
 *
 * Every step records what it saw; screenshots go to SHOTS. A step that fails
 * is reported and the walk goes on.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/toeic-published-ux-browser.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';

import { FE, hidePet, studentPage } from './harness-browser';

const SHOTS = 'D:/Study/KLTN/qa-artifacts/ux-audit-20261106';
mkdirSync(SHOTS, { recursive: true });
const log: Array<{ step: string; ok: boolean; note: string }> = [];
const rec = (step: string, ok: boolean, note = '') => {
  log.push({ step, ok, note });
  console.log(`${ok ? 'OK ' : 'BAD'} ${step}${note ? ' — ' + note : ''}`);
};
const shot = (page: Page, name: string, full = false) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }).catch(() => undefined);
const text = async (page: Page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    rec(name, false, `error: ${(e as Error).message.split('\n')[0].slice(0, 160)}`);
  }
}

async function goToQuestion(page: Page, part: number, n: number) {
  await page.getByRole('tab', { name: `Part ${part}`, exact: true }).click({ timeout: 15_000 });
  const q = page.locator(`article[data-question-number="${n}"]`);
  await q.waitFor({ timeout: 20_000 });
  await q.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  return q;
}

async function startLr(page: Page, mode: 'PRACTICE' | 'FULL_TEST', parts: number[] = []) {
  await page.goto(`${FE}/exams/2`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByText('Làm Full Test').first().waitFor({ timeout: 60_000 });
  await page.locator(`input[name="toeic-mode"][value="${mode}"]`).check();
  for (const p of parts) await page.locator(`input[name="toeic-part"][value="${p}"]`).check();
  await page.getByRole('button', { name: /chế độ toàn màn hình/ }).click();
  await page.waitForURL(/\/toeic\/attempts\/\d+/, { timeout: 60_000 });
  await page.locator('article[data-question-id]').first().waitFor({ timeout: 60_000 });
}

async function lrDesktop() {
  const { browser, page, issues } = await studentPage('ux-lr', 1366);
  await hidePet(page);
  await step('L&R start screen', async () => {
    await page.goto(`${FE}/exams/2`, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.getByText('Làm Full Test').first().waitFor({ timeout: 60_000 });
    await shot(page, '01-lr-start', true);
    const t = await text(page);
    rec('L&R start screen offers both modes and Part choices', t.includes('Luyện tập linh hoạt') && t.includes('Làm Full Test'), '');
    await page.locator('input[name="toeic-mode"][value="PRACTICE"]').check();
    await page.waitForTimeout(500);
    await shot(page, '02-lr-practice-picker', true);
  });
  await step('Practice by Part 3+4+7', async () => {
    await startLr(page, 'PRACTICE', [3, 4, 7]);
    const tabs = await page.getByRole('tablist', { name: 'Part' }).getByRole('tab').allInnerTexts();
    rec('practice shows only Parts 3, 4, 7', JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(['Part 3', 'Part 4', 'Part 7']), tabs.join(','));
    const q50 = await goToQuestion(page, 3, 50);
    await shot(page, '03-lr-p3-three-speakers-q50');
    rec('Part 3 shows no transcript while answering', !(await q50.innerText()).includes('W1:'));
    await goToQuestion(page, 3, 62);
    const table = page.locator('table').first();
    const hasTable = await table.isVisible().catch(() => false);
    rec('q62 graphic is drawn as a table', hasTable, hasTable ? (await table.innerText()).replace(/\s+/g, ' ').slice(0, 80) : 'no table');
    await shot(page, '04-lr-p3-graphic-q62');
    await goToQuestion(page, 4, 95);
    rec('q95 graphic is drawn as a table', await page.locator('table').first().isVisible().catch(() => false));
    await shot(page, '05-lr-p4-graphic-q95');
    await goToQuestion(page, 7, 176);
    const t176 = await text(page);
    rec('q176 shows two documents', /DOCUMENT 1/i.test(t176) && /DOCUMENT 2/i.test(t176));
    await shot(page, '06-lr-p7-double-q176');
    await goToQuestion(page, 7, 186);
    await shot(page, '07-lr-p7-triple-q186');
    const audio = await page.locator('audio').count();
    rec('practice with Listening Parts has an audio player', audio > 0, String(audio));
  });
  await step('submit practice, result and review', async () => {
    const answer = page.locator('article[data-question-number="186"] input[type="radio"]').first();
    await answer.check({ timeout: 10_000 }).catch(() => undefined);
    await page.getByRole('complementary').getByRole('button', { name: 'Nộp bài' }).click({ timeout: 15_000 })
      .catch(async () => page.getByRole('button', { name: 'Nộp bài' }).first().click());
    await page.getByRole('button', { name: 'Xác nhận nộp bài' }).click({ timeout: 15_000 });
    await page.waitForURL(/\/toeic\/results\/\d+/, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await shot(page, '08-lr-practice-result', true);
    const t = await text(page);
    rec('part practice result shows no converted score', !/\b\d{2,3}\s*\/\s*990\b/.test(t), t.slice(0, 120));
    const reviewLink = page.getByRole('link', { name: /Xem lại|Xem đáp án|chi tiết/i }).first();
    if (await reviewLink.count()) {
      await reviewLink.click();
      await page.waitForTimeout(3000);
      await shot(page, '09-lr-review', true);
      const r = await text(page);
      rec('review shows explanations', /Giải thích|giải thích/.test(r));
      rec('review draws the graphic table', (await page.locator('table').count()) > 0, String(await page.locator('table').count()));
    } else rec('result links to the review', false, 'no review link found');
  });
  await step('Full Test Part 1 and Part 2', async () => {
    await startLr(page, 'FULL_TEST');
    await page.waitForTimeout(1500);
    await shot(page, '10-lr-full-part1');
    await goToQuestion(page, 2, 7);
    const t = await page.locator('article[data-question-number="7"]').innerText();
    rec('Part 2 hides the spoken prompt and responses text', !/When will the new printer/.test(t), t.replace(/\s+/g, ' ').slice(0, 80));
    await shot(page, '11-lr-full-part2');
  });
  rec('L&R desktop console errors', issues.length === 0, issues.slice(0, 3).join(' | '));
  await browser.close();
}

async function lrMobile() {
  const { browser, page, issues } = await studentPage('ux-lr-390', 390);
  await hidePet(page);
  await step('Practice by Part at 390 px', async () => {
    await page.goto(`${FE}/exams/2`, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.getByText('Làm Full Test').first().waitFor({ timeout: 60_000 });
    await shot(page, '20-mobile-start', true);
    rec('start screen fits 390 px', (await overflow(page)) <= 1, `${await overflow(page)}px`);
    await startLr(page, 'PRACTICE', [3, 7]);
    await goToQuestion(page, 3, 62);
    await shot(page, '21-mobile-p3-graphic');
    rec('graphic fits 390 px', (await overflow(page)) <= 1, `${await overflow(page)}px`);
    await goToQuestion(page, 7, 186);
    await shot(page, '22-mobile-p7-triple');
    rec('triple passage fits 390 px', (await overflow(page)) <= 1, `${await overflow(page)}px`);
  });
  rec('L&R mobile console errors', issues.length === 0, issues.slice(0, 3).join(' | '));
  await browser.close();
}

async function swRoom() {
  const { browser, page, issues } = await studentPage('ux-sw', 1366, true);
  await hidePet(page);
  await step('S&W Speaking tabs', async () => {
    await page.goto(`${FE}/exams/3`, { waitUntil: 'networkidle', timeout: 90_000 });
    await shot(page, '30-sw-start', true);
    await page.getByRole('button', { name: 'Bắt đầu làm bài' }).click({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
    await shot(page, '31-sw-speaking-q1-2');
    for (const [tab, name] of [['Câu 3–4', '32-sw-speaking-q3-4'], ['Câu 5–7', '33-sw-speaking-q5-7'], ['Câu 8–10', '34-sw-speaking-q8-10'], ['Câu 11', '35-sw-speaking-q11']] as const) {
      const t = page.getByRole('tab', { name: tab });
      if (await t.count()) {
        await t.click();
        await page.waitForTimeout(1200);
        await shot(page, name, true);
      } else rec(`S&W tab ${tab} exists`, false, (await page.getByRole('tab').allInnerTexts()).join(','));
    }
    const t = await text(page);
    rec('Q8-10 shows the schedule', /Training Day|Opening session/.test(t));
  });
  await step('S&W Writing tabs', async () => {
    await page.getByRole('button', { name: 'Nộp bài' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận nộp bài' }).click();
    await page.getByRole('tab', { name: 'Câu 1–5' }).waitFor({ timeout: 40_000 });
    await shot(page, '36-sw-writing-q1-5', true);
    await page.getByRole('tab', { name: 'Câu 6–7' }).click();
    await page.waitForTimeout(1200);
    await shot(page, '37-sw-writing-q6-7', true);
    rec('Q6-7 shows the e-mail to answer', /From: Linh Tran|From:/.test(await text(page)));
    const essay = page.getByRole('tab', { name: 'Câu 8' });
    if (await essay.count()) {
      await essay.click();
      await page.waitForTimeout(1000);
      await shot(page, '38-sw-writing-q8', true);
      rec('Q8 asks for at least 300 words', /300 words/.test(await text(page)));
    }
  });
  rec('S&W console errors', issues.length === 0, issues.slice(0, 3).join(' | '));
  await browser.close();
}

async function fourSkills() {
  const { browser, page, issues } = await studentPage('ux-4s', 1366, true);
  await hidePet(page);
  await step('4 Skills L&R room graphic', async () => {
    await page.goto(`${FE}/exams/5`, { waitUntil: 'networkidle', timeout: 90_000 });
    await shot(page, '40-4s-start', true);
    await page.getByRole('button', { name: 'Bắt đầu làm bài' }).click({ timeout: 60_000 });
    await page.waitForURL(/\/toeic\/attempts\//, { timeout: 60_000 });
    await page.getByRole('tab', { name: 'Part 1', exact: true }).waitFor({ timeout: 60_000 });
    await goToQuestion(page, 4, 98);
    rec('4 Skills q98 graphic is drawn as a table', await page.locator('table').first().isVisible().catch(() => false));
    await shot(page, '41-4s-p4-graphic-q98');
  });
  await step('4 Skills Speaking and Writing', async () => {
    await page.getByRole('button', { name: 'Nộp bài' }).first().click();
    await page.getByRole('button', { name: 'Xác nhận nộp bài' }).click();
    await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Câu 3–4' }).click();
    await page.waitForTimeout(1500);
    await shot(page, '42-4s-speaking-q3-4', true);
    await page.getByRole('tab', { name: 'Câu 8–10' }).click();
    await page.waitForTimeout(1200);
    await shot(page, '43-4s-speaking-q8-10', true);
    await page.getByRole('button', { name: 'Nộp bài' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận nộp bài' }).click();
    await page.getByRole('tab', { name: 'Câu 1–5' }).waitFor({ timeout: 40_000 });
    await shot(page, '44-4s-writing-q1-5', true);
    await page.getByRole('tab', { name: 'Câu 6–7' }).click();
    await page.waitForTimeout(1200);
    await shot(page, '45-4s-writing-q6-7', true);
    rec('4 Skills Q6-7 shows the e-mail', /Daniel Moore|From:/.test(await text(page)));
  });
  rec('4 Skills console errors', issues.length === 0, issues.slice(0, 3).join(' | '));
  await browser.close();
}

async function main() {
  await lrDesktop();
  await lrMobile();
  await swRoom();
  await fourSkills();
  writeFileSync(`${SHOTS}/log.json`, JSON.stringify(log, null, 2));
  console.log(`\nsteps ${log.length}, bad ${log.filter((l) => !l.ok).length}; shots in ${SHOTS}`);
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
