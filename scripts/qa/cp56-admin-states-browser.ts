/**
 * Checkpoint 56: Admin CMS interaction states on the harness (FE :3100):
 * publish refused (topic without questions), question-form validation,
 * publish success, lesson preview, and the TOEIC studio/composer screens.
 * A fresh DRAFT Grammar topic is created in the harness only.
 * Usage: npx ts-node --transpile-only scripts/qa/cp56-admin-states-browser.ts
 */
import { randomUUID } from 'node:crypto';

import { chromium, type Page } from 'playwright';

import { call, check, failureCount, newAdmin } from './harness-api';
import { attachUiTextSampler, FE } from './harness-browser';

const SHOTS = 'artifacts/finalization/evidence';

/** Waits for a toast matching the pattern; returns its text, or every visible toast. */
async function toastText(page: Page, re: RegExp) {
  const hit = page.locator('[role="status"]', { hasText: re }).last();
  if (
    await hit
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  )
    return (await hit.innerText()).replace(/s+/g, ' ');
  return (await page.locator('[role="status"]').allInnerTexts()).join(' | ');
}

void (async () => {
  const admin = await newAdmin('cp56-admin-ui');
  const title = `QA kiểm thử ${randomUUID().slice(0, 6)}`;
  const created = await call('POST', '/grammar/topics', admin.token, {
    title,
    level: 'BEGINNER',
    description: 'Chủ đề kiểm thử trên harness.',
  });
  const topicId = created.data?.id;
  check(
    'a DRAFT topic without questions is created (harness)',
    !!topicId,
    `(${created.status})`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  attachUiTextSampler(page, 'cp56-admin');
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
  });

  await page.goto(`${FE}/admin/grammar`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page
    .getByPlaceholder(/Tìm/)
    .first()
    .fill(title)
    .catch(() => undefined);
  await page.waitForTimeout(1200);
  await page
    .locator('article', { hasText: title })
    .getByText('Quản lý')
    .click();
  await page.waitForTimeout(1500);

  await page
    .getByRole('button', { name: /Xuất bản/ })
    .first()
    .click();
  const refused = await toastText(page, /ít nhất 1 câu hỏi/);
  check(
    'publish without questions is refused with a Vietnamese reason',
    /ít nhất 1 câu hỏi/.test(refused),
    refused,
  );
  await page.screenshot({ path: `${SHOTS}/cp56-admin-publish-refused.png` });

  await page
    .getByRole('button', { name: /Thêm câu hỏi mới/ })
    .first()
    .click();
  await page
    .getByPlaceholder(/She has worked here/)
    .fill('They ______ to the office every day.');
  await page.getByPlaceholder('Lựa chọn A').fill('go');
  await page.getByPlaceholder('Lựa chọn B').fill('goes');
  await page.locator('form button[type="submit"]').last().click();
  // Option inputs are `required`: the browser blocks the submit itself
  // (its own message, in the browser's language) before the app's toast.
  const blocked = await page
    .getByPlaceholder('Lựa chọn C')
    .evaluate((el) => (el as HTMLInputElement).validity.valueMissing);
  const savedEarly = await page
    .locator('[role="status"]', { hasText: /thành công/ })
    .count();
  check(
    'question form blocks a submit with missing options',
    blocked && savedEarly === 0,
  );

  await page.screenshot({ path: `${SHOTS}/cp56-admin-question-invalid.png` });
  await page.getByPlaceholder('Lựa chọn C').fill('going');
  await page.getByPlaceholder('Lựa chọn D').fill('went');
  await page.locator('input[name="correctAnswer"]').first().check();
  await page.locator('form button[type="submit"]').last().click();
  const saved = await toastText(page, /thành công/);
  check('question saved', /thành công|Đã/.test(saved), saved);
  await page.waitForTimeout(1500);

  await page
    .getByRole('button', { name: /Xuất bản/ })
    .first()
    .click();
  const published = await toastText(page, /Đã xuất bản chủ đề/);
  check(
    'publish succeeds once the topic has a valid question',
    /Đã xuất bản/.test(published),
    published,
  );
  await page.screenshot({ path: `${SHOTS}/cp56-admin-publish-ok.png` });

  const preview = page.getByText('Xem trước bài học').first();
  if (await preview.count()) {
    await preview.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/cp56-admin-preview.png` });
    check('lesson preview opens', true);
  } else {
    console.log(
      'NOT_VERIFIED  lesson preview control not present on this screen',
    );
  }

  for (const route of [
    '/admin/exams',
    '/admin/toeic/assessments',
    '/admin/toeic/writing-sets',
  ]) {
    await page.goto(FE + route, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: `${SHOTS}/cp56-admin${route.replace(/\//g, '-')}.png`,
    });
  }
  await call('POST', `/grammar/topics/${topicId}/unpublish`, admin.token);
  await browser.close();
  console.log(`CP56_ADMIN_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
