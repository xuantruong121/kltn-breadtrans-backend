/**
 * Every learner page, as an onboarded learner, at 390 px and 1366 px:
 * no sideways scroll, no page error, no API 5xx, no leaked "undefined" /
 * "NaN" / "[object Object]" (harness :3100/:3101 only).
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/learner-mobile-sweep.ts
 */
import { chromium } from 'playwright';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { FE, hidePet } from './harness-browser';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/audit/sweep`;
const ROUTES = [
  '/dashboard',
  '/hub',
  '/diagnostic',
  '/listening',
  '/listening/9',
  '/reading',
  '/reading?category=grammar',
  '/reading/mistakes',
  '/speaking',
  '/speaking/16',
  '/writing',
  '/writing/17',
  '/exams',
  '/toeic/history',
  '/toeic/stats',
  '/flashcard',
  '/flashcard/1',
  '/vocabulary/saved',
  '/vocabulary/study',
  '/arena',
  '/market',
  '/pet',
  '/plans',
  '/notifications',
  '/messages',
  '/change-password',
];

async function main() {
  const student = await newStudent('sweep');
  await call('PUT', '/learning-path/profile', student.token, {
    onboarded: true,
    goal: 'GENERAL',
    track: 'GENERAL',
    minutesPerDay: 15,
  });
  const browser = await chromium.launch();
  for (const width of [390, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 860 } });
    let issues: string[] = [];
    page.on('pageerror', (e) =>
      issues.push(`pageerror ${e.message.slice(0, 140)}`),
    );
    page.on('response', (r) => {
      // Practice audio sits in the private bucket the harness fakes empty.
      if (
        r.url().startsWith(BE) &&
        r.status() >= 500 &&
        !/\/audio(\?|$)/.test(r.url())
      )
        issues.push(`api ${r.status()} ${r.url().slice(21)}`);
    });
    await page.goto(`${FE}/login`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.click('button[aria-controls="email-login-panel"]');
    await page.fill('input[name="email"]', student.email);
    await page.fill('input[name="password"]', student.password);
    await page.click('#email-login-panel button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 60_000,
      waitUntil: 'commit',
    });
    for (const route of ROUTES) {
      issues = [];
      await page
        .goto(`${FE}${route}`, { waitUntil: 'networkidle', timeout: 120_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200);
      await hidePet(page).catch(() => undefined);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      const text = await page.locator('body').innerText();
      const leak = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(text)?.[0];
      const ok = overflow <= 1 && !leak && issues.length === 0;
      if (!ok)
        await page.screenshot({
          path: `${SHOTS}/${width}-${route.replace(/[/?=&]+/g, '_')}.png`,
        });
      check(
        `@${width} ${route} -> ${new URL(page.url()).pathname}`,
        ok,
        [
          overflow > 1 ? `overflow ${overflow}px` : '',
          leak ? `leak ${leak}` : '',
          ...issues,
        ]
          .filter(Boolean)
          .join(' | ')
          .slice(0, 300),
      );
    }
    await page.close();
  }
  await browser.close();
  console.log(`failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
