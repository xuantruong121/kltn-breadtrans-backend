/**
 * The "Lĩnh vực" field of the skill editors, on the disposable harness.
 *
 * - Editing a listening item: the field sits in "Thông tin nội dung" with
 *   Tiêu đề and Trình độ, visible without scrolling the side column; a click
 *   saves, and a reload keeps it.
 * - A new item: the buttons are locked with a note to save first.
 * - The list filter and the Speaking editor say "Lĩnh vực", never "Ngành".
 *
 * Usage: HARNESS_DB=<db> QA_LISTENING_ID=<id> QA_SPEAKING_SET=<id> \
 *   npx ts-node --transpile-only scripts/qa/admin-track-field-browser.ts
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

import { check, failureCount, newAdmin } from './harness-api';
import { FE } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/track-field`;
const LISTENING = Number(process.env.QA_LISTENING_ID ?? 1);
const SPEAKING = process.env.QA_SPEAKING_SET ?? 'practice-describe-picture-b1';

const tagsOf = (id: number) =>
  harnessQuery(
    `select track from "ContentTrackTag" where "contentType" = 'QUIZ' and "contentId" = ${id} order by track`,
  ).map((row) => row[0]);

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  harnessExec(
    `delete from "ContentTrackTag" where "contentType" = 'QUIZ' and "contentId" = ${LISTENING}`,
  );
  const admin = await newAdmin('track-admin');
  const browser = await chromium.launch();

  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    await page.goto(`${FE}/login`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.click('button[aria-controls="email-login-panel"]');
    await page.fill('input[name="email"]', admin.email);
    await page.fill('input[name="password"]', admin.password);
    await page.click('#email-login-panel button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 60_000,
      waitUntil: 'commit',
    });

    await page.goto(`${FE}/admin/listening/${LISTENING}`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    const group = page.getByRole('group', { name: 'Lĩnh vực' });
    await group.waitFor({ timeout: 60_000 });
    const info = page
      .locator('section')
      .filter({
        has: page.getByRole('heading', { name: 'Thông tin nội dung' }),
      });
    check(
      `${width}px: "Lĩnh vực" is inside "Thông tin nội dung"`,
      (await info.getByRole('group', { name: 'Lĩnh vực' }).count()) === 1,
    );
    if (width === 1366) {
      const box = await group.boundingBox();
      check(
        '1366px: visible on load, no scrolling needed',
        box !== null && box.y + box.height <= 900,
        `bottom=${box ? Math.round(box.y + box.height) : 'none'}`,
      );
    }
    await page.screenshot({ path: `${SHOTS}/edit-${width}.png` });

    if (width === 1366) {
      await group.getByRole('button', { name: 'Công nghệ thông tin' }).click();
      await page.waitForTimeout(1500);
      check(
        'a click saves the field',
        tagsOf(LISTENING).join(',') === 'IT_SOFTWARE',
        tagsOf(LISTENING).join(','),
      );
      await page.reload({ waitUntil: 'networkidle' });
      const it = page
        .getByRole('group', { name: 'Lĩnh vực' })
        .getByRole('button', { name: 'Công nghệ thông tin' });
      await it.waitFor({ timeout: 60_000 });
      check(
        'a reload keeps it selected',
        (await it.getAttribute('aria-pressed')) === 'true',
      );

      await page.goto(`${FE}/admin/listening/new`, {
        waitUntil: 'networkidle',
      });
      const fresh = page.getByRole('group', { name: 'Lĩnh vực' });
      await fresh.waitFor({ timeout: 60_000 });
      check(
        'a new item: buttons locked with a note to save first',
        (await fresh.getByRole('button').first().isDisabled()) &&
          (await fresh.innerText()).includes('Lưu bài trước'),
      );
      await page.screenshot({ path: `${SHOTS}/new-${width}.png` });

      await page.goto(`${FE}/admin/listening`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const listText = await page.locator('#admin-main').innerText();
      check(
        'the list filter says "Lĩnh vực"',
        listText.includes('Lĩnh vực') && !/Ngành/.test(listText),
      );

      await page.goto(`${FE}/admin/speaking/${SPEAKING}`, {
        waitUntil: 'networkidle',
      });
      await page
        .getByRole('heading', { name: 'Lĩnh vực' })
        .waitFor({ timeout: 60_000 })
        .catch(() => undefined);
      check(
        'the Speaking editor card says "Lĩnh vực"',
        (await page.getByRole('heading', { name: 'Lĩnh vực' }).count()) === 1,
      );
      await page.screenshot({ path: `${SHOTS}/speaking-${width}.png` });
    }
    check(
      `${width}px: no page errors`,
      errors.length === 0,
      errors.join(' | '),
    );
    await page.close();
  }
  await browser.close();

  console.log(`\nTRACK_FIELD_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
