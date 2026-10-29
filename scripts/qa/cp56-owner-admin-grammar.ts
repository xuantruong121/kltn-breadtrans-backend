/**
 * Checkpoint 56: read-only Admin check on the owner's app (:3000) after the
 * Grammar replacement. Only views pages; it clicks no mutating action.
 * Usage: npx ts-node --transpile-only scripts/qa/cp56-owner-admin-grammar.ts
 */
import { chromium } from 'playwright';
import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn('QA_OWNER_READONLY', 'cp56-owner-admin-grammar drives the owner app (:3000/:3001, kltn_db) read-only; logins still write sessions');

const FE = 'http://localhost:3000';
const SHOTS = 'artifacts/finalization/evidence';

void (async () => {
  let fails = 0;
  const check = (n: string, ok: boolean, d = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
  };
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', 'admin@breadtrans.com');
  await page.fill('input[name="password"]', 'Password123!');
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
  await page.goto(`${FE}/admin/grammar`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);
  const cards = page.locator('article', {
    hasText: 'Present Simple & Adverbs of Frequency',
  });
  const statuses = await cards.allInnerTexts();
  check(
    'Admin lists the original as Bản nháp and the replacement as Đã xuất bản',
    statuses.length === 2 &&
      statuses.some((t) => /Bản nháp/.test(t)) &&
      statuses.some((t) => /Đã xuất bản/.test(t)),
    statuses.map((t) => t.replace(/\s+/g, ' ').slice(0, 60)).join(' || '),
  );
  await page.screenshot({
    path: `${SHOTS}/cp56-owner-admin-grammar.png`,
    fullPage: true,
  });
  await cards.filter({ hasText: 'Đã xuất bản' }).getByText('Quản lý').click();
  await page.waitForTimeout(2000);
  const detail = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'replacement detail shows the corrected options',
    /are opening/.test(detail) &&
      /is having/.test(detail) &&
      /are leaving/.test(detail) &&
      !/\bBEGINNER\b/.test(detail),
  );
  const preview = page.getByText('Xem trước bài học').first();
  if (await preview.count()) {
    await preview.click();
    await page.waitForTimeout(1500);
    const pv = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check('preview renders the corrected questions', /reception desk/.test(pv));
    await page.screenshot({
      path: `${SHOTS}/cp56-owner-admin-grammar-preview.png`,
      fullPage: true,
    });
  } else check('preview control present', false);
  await browser.close();
  console.log(`CP56_OWNER_ADMIN_FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
