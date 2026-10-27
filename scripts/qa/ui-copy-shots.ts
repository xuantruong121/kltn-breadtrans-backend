/**
 * Screenshots of representative learner and Admin screens after the copy
 * cleanup (harness FE :3100), at 1366 px and 390 px, plus a horizontal
 * overflow check. Usage: npx ts-node --transpile-only scripts/qa/ui-copy-shots.ts
 */
import { chromium, type Page } from 'playwright';

import { newAdmin, newProStudent } from './harness-api';
import { FE } from './harness-browser';

const SHOTS = 'artifacts/finalization/evidence';
const LEARNER = [
  '/dashboard',
  '/grammar',
  '/plans',
  '/courses/1',
  '/exams',
  '/speaking',
];
const ADMIN = [
  '/admin/toeic/assessments',
  '/admin/toeic/writing-sets',
  '/admin/grammar',
  '/admin/quizzes',
];

async function login(page: Page, email: string, password: string) {
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
}

(async () => {
  let fails = 0;
  const browser = await chromium.launch();
  for (const [role, routes] of [
    ['learner', LEARNER],
    ['admin', ADMIN],
  ] as const) {
    const acct =
      role === 'admin'
        ? await newAdmin('ui-shot-admin')
        : await newProStudent('ui-shot-pro');
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await login(page, acct.email, acct.password);
      for (const route of routes) {
        await page
          .goto(FE + route, { waitUntil: 'networkidle', timeout: 120_000 })
          .catch(() => undefined);
        await page.waitForTimeout(1500);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        const name = `ui-copy-${role}${route.replace(/\//g, '-')}-${width}.png`;
        await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: false });
        const ok = overflow <= 1;
        if (!ok) fails++;
        console.log(
          `${ok ? 'PASS' : 'FAIL'}  ${role} ${route} @${width}: horizontal overflow ${overflow}px  ${name}`,
        );
      }
      await page.close();
    }
  }
  await browser.close();
  console.log(`FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
