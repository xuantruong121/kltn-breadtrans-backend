/**
 * Register, log in and log out through the UI on the disposable harness.
 */
import { randomUUID } from 'node:crypto';

import { chromium } from 'playwright';

import { check, failureCount } from './harness-api';
import { FE } from './harness-browser';
import { harnessQuery } from './harness-db';

async function main() {
  console.log('\n== Auth (browser)');
  const email = `ui-${randomUUID().slice(0, 8)}@harness.local`;
  const password = `Harness-${randomUUID().slice(0, 6)}-Aa1!`;
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await page.goto(`${FE}/register`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.fill('#register-full-name', 'Người Học Thử');
  await page.fill('#register-email', email);
  const pw = page.locator('input[type="password"]');
  for (let i = 0; i < (await pw.count()); i += 1)
    await pw.nth(i).fill(password);
  const consent = page.locator('input[type="checkbox"]');
  for (let i = 0; i < (await consent.count()); i += 1)
    await consent
      .nth(i)
      .check()
      .catch(() => undefined);
  await page.getByRole('button', { name: /Đăng ký tài khoản/ }).click();
  await page.waitForTimeout(3000);
  const [row] = harnessQuery(
    `select role::text, ("emailVerifiedAt" is not null) from "User" where email = '${email}'`,
  );
  check(
    'the account is created as a STUDENT',
    row?.[0] === 'STUDENT',
    `(${row?.join('/')})`,
  );
  const afterRegister = await page.locator('body').innerText();
  check(
    'the learner sees a success step',
    /thành công|Đăng nhập/i.test(afterRegister),
  );

  await page.goto(`${FE}/login`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'wrong-password-1A!');
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForTimeout(2500);
  check(
    'a wrong password keeps the learner on the login page with a message',
    page.url().includes('/login') &&
      /không đúng|sai|không hợp lệ|Invalid/i.test(
        await page.locator('body').innerText(),
      ),
  );
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page
    .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    .catch(() => undefined);
  check(
    'correct credentials log in',
    !page.url().includes('/login'),
    `(${page.url().slice(21)})`,
  );

  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  const avatar = page.getByRole('button', { name: 'Menu tài khoản' });
  await avatar.click().catch(() => undefined);
  await page.waitForTimeout(800);
  const logout = page
    .getByRole('button', { name: /Đăng xuất/ })
    .or(page.getByRole('menuitem', { name: /Đăng xuất/ }))
    .first();
  if (await logout.isVisible().catch(() => false)) {
    await logout.click();
    const confirm = page.getByRole('button', { name: /^Đăng xuất$/ }).nth(1);
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false))
      await confirm.click();
    await page.waitForTimeout(2500);
    await page.goto(`${FE}/dashboard`, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
    await page.waitForTimeout(1500);
    check(
      'after logout, a protected page sends the learner to login',
      /\/login|\/$/.test(new URL(page.url()).pathname),
      `(${page.url().slice(21)})`,
    );
  } else {
    check('a logout control is reachable from the header', false);
  }
  await browser.close();
  console.log(`\nAUTH_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
