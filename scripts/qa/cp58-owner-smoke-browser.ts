/**
 * Checkpoint 58 owner app (:3000 / :3001, kltn_db) smoke as the QA FREE
 * learner. Read-only: it opens catalogs and never submits. It shows that the
 * owner app runs the same rules as the harness: shared filters with Dễ → Khó,
 * Writing B1 labelled Trung cấp and locked for PRO, and the "Viết câu theo
 * tranh" tab (picture exercises deployed 2026-10-28).
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-owner-smoke-browser.ts
 */
import { chromium } from 'playwright';
import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn('QA_OWNER_READONLY', 'cp58-owner-smoke-browser drives the owner app (:3000/:3001, kltn_db) read-only; logins still write sessions');

const FE = 'http://localhost:3000';

void (async () => {
  let fails = 0;
  const check = (n: string, ok: boolean, d = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
  };
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors: string[] = [];
  const writes: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes(':3001') && r.status() >= 500)
      errors.push(`${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    if (
      r.url().includes(':3001') &&
      r.method() !== 'GET' &&
      !/\/auth\/(login|refresh)/.test(r.url())
    )
      writes.push(`${r.method()} ${r.url()}`);
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
    timeout: 90_000,
  });

  for (const path of ['/listening', '/reading', '/speaking', '/writing']) {
    await page.goto(`${FE}${path}`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(2000);
    const sort = await page.getByLabel('Sắp xếp theo độ khó').inputValue();
    const count = Number(
      (await page.getByTestId('catalog-result-count').innerText()).match(
        /\d+/,
      )?.[0],
    );
    const cards = await page.locator('article').count();
    check(
      `${path}: Dễ → Khó default, count ${count} = cards ${cards}`,
      sort === 'EASY_TO_HARD' && count === cards && cards > 0,
    );
  }
  const email = page.locator('article', {
    hasText: 'Viết email công việc (B1)',
  });
  const emailText = (await email.innerText()).replace(/\s+/g, ' ');
  check(
    'Writing B1 email: Trung cấp · B1, "Mở khóa với PRO"',
    emailText.includes('Trung cấp · B1') &&
      emailText.includes('Mở khóa với PRO') &&
      !emailText.includes('Cơ bản'),
    emailText.slice(0, 120),
  );
  // Picture writing was deployed to kltn_db on 2026-10-28 (owner-approved).
  check(
    'picture tab shown now that kltn_db holds picture exercises',
    (await page.getByRole('tab', { name: 'Viết câu theo tranh' }).count()) ===
      1,
  );
  await page.screenshot({
    path: 'artifacts/qa-screens/cp58-owner-writing-1440.png',
  });
  check('no write requests', writes.length === 0, writes.join(' | '));
  check('no 5xx', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\nCP58_OWNER_SMOKE_FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
