/**
 * Checkpoint 54: owner app (:3000) Grammar check as the QA FREE learner.
 * Read-mostly: opens the catalog and one published topic, answers it once.
 */
import { chromium } from 'playwright';

const FE = 'http://localhost:3000';
const SHOTS = 'artifacts/finalization/evidence';

(async () => {
  let fails = 0;
  const check = (n: string, ok: boolean, d = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
  };
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  const errors: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes(':3001') && r.status() >= 500)
      errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', 'qa-cp51-free@breadtrans.local');
  await page.fill('input[name="password"]', 'Cp51-Free-Qa-2026!');
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
  await page.goto(`${FE}/grammar`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'catalog shows a published topic',
    body.includes('Passive Voice') && body.includes('Conditionals'),
  );
  check(
    'catalog hides DRAFT topics 1-2',
    !body.includes('Present Simple & Adverbs') &&
      !body.includes('Past Simple & Time'),
  );
  check(
    'no PLUS/PRO paywall on /grammar',
    !/Mở khóa với PLUS|Yêu cầu gói|Mở khóa với PRO/.test(body),
  );
  await page.screenshot({
    path: `${SHOTS}/cp54-owner-grammar-free-1366.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: `${SHOTS}/cp54-owner-grammar-free-390.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page
    .locator('div', { hasText: /^Comparatives/ })
    .locator('xpath=ancestor-or-self::*[.//button[contains(., "Bắt đầu")]][1]')
    .getByRole('button', { name: /Bắt đầu/ })
    .first()
    .click();
  await page.waitForTimeout(2000);
  const topic = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'topic 8 opens with the corrected question',
    topic.includes('Comparatives') && /three routes/.test(topic),
    topic.slice(0, 160),
  );
  await page.screenshot({
    path: `${SHOTS}/cp54-owner-grammar-topic8-1366.png`,
    fullPage: true,
  });
  check('no server errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
