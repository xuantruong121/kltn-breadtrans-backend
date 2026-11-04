/**
 * Trial banner and referral in the browser, on the disposable harness.
 *
 * - A learner who finished the entry diagnostic sees "Bạn đang dùng thử Plus"
 *   with the gradings left and "Mua gói Plus" on the dashboard.
 * - /plans shows "Mời bạn cùng học" with the learner's own invite link.
 * - Opening an invite link (/register?ref=CODE) before signing in, then
 *   signing in, enters the code once.
 *
 * Usage: HARNESS_DB=<db> QA_DB_NAME=<db> QA_WAV=<wav> npx ts-node --transpile-only scripts/qa/trial-referral-browser.ts
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

import { call, check, failureCount, newStudent } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';
import { runCase } from './cp60diag-observed-api';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/trial-referral`;

async function main() {
  mkdirSync(SHOTS, { recursive: true });

  for (const width of [1366, 390]) {
    const learner = await studentPage(`trial-ui-${width}`, width);
    await runCase(
      `trial-ui-${width}`,
      { listening: 6, reading: 6, speaking: [], writing: [] },
      learner.account,
    );
    const p = learner.page;
    await p.goto(`${FE}/dashboard`);
    await hidePet(p);
    const banner = p.getByText(/Bạn đang dùng thử Plus · còn \d ngày/);
    await banner.waitFor({ timeout: 60_000 });
    const text = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    check(
      `${width}px: dashboard shows the trial with 5 Speaking / 3 Writing gradings`,
      text.includes('Còn 5 lượt chấm Nói và 3 lượt chấm Viết'),
    );
    check(
      `${width}px: the banner offers "Mua gói Plus"`,
      await p.getByRole('link', { name: 'Mua gói Plus' }).first().isVisible(),
    );
    await p.screenshot({ path: `${SHOTS}/trial-banner-${width}.png` });

    await p.goto(`${FE}/plans`);
    await hidePet(p);
    const card = p.getByRole('region', { name: /Mời bạn cùng học/ });
    await card.waitFor({ timeout: 60_000 });
    const mine = (await call('GET', '/referrals/me', learner.account.token))
      .data;
    const cardText = await card.innerText();
    check(
      `${width}px: /plans shows the learner's invite link`,
      cardText.includes(`/register?ref=${mine.code}`) &&
        cardText.includes(mine.code),
    );
    const overflow = await p.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    check(
      `${width}px: no sideways page scroll`,
      overflow <= 0,
      String(overflow),
    );
    await card.screenshot({ path: `${SHOTS}/referral-card-${width}.png` });
    await learner.browser.close();

    if (width === 1366) {
      // A friend opens the invite link, then signs in.
      const friend = await newStudent('ref-link-friend');
      const browser = await chromium.launch();
      const page = await browser.newPage({
        viewport: { width: 1366, height: 900 },
      });
      await page.goto(`${FE}/register?ref=${mine.code.toLowerCase()}`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      });
      // The code is kept once the page has hydrated.
      await page.waitForFunction(
        () => !!window.localStorage.getItem('bt_referral_code'),
        undefined,
        { timeout: 60_000 },
      );
      await page.goto(`${FE}/login`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      });
      await page.click('button[aria-controls="email-login-panel"]');
      await page.fill('input[name="email"]', friend.email);
      await page.fill('input[name="password"]', friend.password);
      await page.click('#email-login-panel button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
        timeout: 60_000,
        waitUntil: 'commit',
      });
      let referrer: string | undefined;
      for (let i = 0; i < 20 && !referrer; i += 1) {
        await page.waitForTimeout(1000);
        referrer = harnessQuery(
          `select "referrerId" from "Referral" where "inviteeId" = ${friend.userId}`,
        )[0]?.[0];
      }
      check(
        'the invite link enters the code after sign-in',
        referrer === String(learner.account.userId),
        `(${referrer})`,
      );
      const stored = await page.evaluate(() =>
        window.localStorage.getItem('bt_referral_code'),
      );
      check(
        'the stored code is cleared after use',
        stored === null,
        String(stored),
      );
      await browser.close();
    }
  }

  console.log(`\nTRIAL_REFERRAL_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
