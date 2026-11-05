/**
 * Sign-in across tabs of one browser, on the disposable harness.
 *
 * Without "Ghi nhớ đăng nhập" the session is kept per tab (sessionStorage).
 * A tab opened later ("Open in new tab") gets the session from an open tab
 * and stays signed in; a sign-out in one tab ends the account in the other;
 * once every tab is closed, a new tab is signed out, as "not remembered"
 * promises.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/auth-tab-session-browser.ts
 */
import { chromium } from 'playwright';

import { check, failureCount, newStudent } from './harness-api';
import { FE } from './harness-browser';

async function main() {
  const learner = await newStudent('tab-session');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });

  const first = await context.newPage();
  await first.goto(`${FE}/login`, { waitUntil: 'networkidle', timeout: 120_000 });
  await first.click('button[aria-controls="email-login-panel"]');
  await first.fill('input[name="email"]', learner.email);
  await first.fill('input[name="password"]', learner.password);
  const remember = first.locator('#rememberMe');
  check('"Ghi nhớ đăng nhập" is off by default', !(await remember.isChecked()));
  await first.click('#email-login-panel button[type="submit"]');
  await first.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000, waitUntil: 'commit' });
  await first.waitForTimeout(1500);
  const kept = await first.evaluate(() => ({
    session: !!window.sessionStorage.getItem('auth-storage-junior'),
    local: !!window.localStorage.getItem('auth-storage-junior'),
  }));
  check('the session is kept for this tab only', kept.session && !kept.local, JSON.stringify(kept));

  // "Open in new tab": a fresh tab of the same browser, empty sessionStorage.
  const second = await context.newPage();
  await second.goto(`${FE}/hub`, { waitUntil: 'networkidle', timeout: 120_000 });
  await second.waitForTimeout(2500);
  check('a new tab opened on /hub stays signed in', !new URL(second.url()).pathname.startsWith('/login'), second.url());
  const adopted = await second.evaluate(() => {
    const raw = window.sessionStorage.getItem('auth-storage-junior');
    return raw ? JSON.parse(raw)?.state?.user?.email : null;
  });
  check('the new tab holds the same account, for this tab only', adopted === learner.email, String(adopted));

  // Sign out in the first tab: the second follows.
  await first.evaluate(() => window.dispatchEvent(new Event('breadtrans:logout')));
  await second.waitForTimeout(2000);
  const after = await second.evaluate(() => window.sessionStorage.getItem('auth-storage-junior'));
  const signedOut = !after || JSON.parse(after)?.state?.user === null;
  check('a sign-out in one tab signs the other tab out', signedOut, String(after).slice(0, 80));

  // Every tab closed: a new tab is signed out ("not remembered").
  await first.close();
  await second.close();
  const third = await context.newPage();
  await third.goto(`${FE}/hub`, { waitUntil: 'networkidle', timeout: 120_000 });
  await third.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000, waitUntil: 'commit' });
  check('with no tab open, a new tab asks to sign in again', new URL(third.url()).pathname.startsWith('/login'), third.url());

  await browser.close();
  console.log(`\nAUTH_TAB_SESSION_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
