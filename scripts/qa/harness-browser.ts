/** Shared Playwright login for the disposable harness (FE :3100). */
import { chromium, type Browser, type Page } from 'playwright';

import { newProStudent, newStudent } from './harness-api';

export const FE = 'http://localhost:3100';

export async function studentPage(
  label: string,
  width = 1366,
  pro = false,
  // e.g. Chromium's fake microphone for recording tests
  launchArgs: string[] = [],
): Promise<{
  browser: Browser;
  page: Page;
  account: Awaited<ReturnType<typeof newStudent>>;
  issues: string[];
}> {
  const account = pro ? await newProStudent(label) : await newStudent(label);
  const browser = await chromium.launch({ args: launchArgs });
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    ...(launchArgs.length ? { permissions: ['microphone'] } : {}),
  });
  const issues: string[] = [];
  page.on('pageerror', (e) =>
    issues.push(`pageerror: ${e.message.slice(0, 200)}`),
  );
  page.on('console', (m) => {
    if (m.type() === 'error') issues.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith('http://localhost:3101') && r.status() >= 500)
      issues.push(
        `api ${r.status()} ${r.request().method()} ${r.url().slice(21)}`,
      );
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
  return { browser, page, account, issues };
}

/** Hide the floating companion pet so it cannot cover controls. */
export async function hidePet(page: Page) {
  await page
    .addStyleTag({
      content:
        '[data-companion-pet], [aria-label*="thú cưng" i] { display:none !important }',
    })
    .catch(() => undefined);
}
