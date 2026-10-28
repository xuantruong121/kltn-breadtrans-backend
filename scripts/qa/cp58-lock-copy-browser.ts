/**
 * Checkpoint 58 lock copy (harness, Chromium 1366): a locked item names the
 * plan that really opens it. Listening/Reading B1+ say PLUS, Speaking/Writing
 * B1+ say PRO, and a PLUS learner is never told PLUS unlocks a PRO-only item.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-lock-copy-browser.ts
 */
import type { Page } from 'playwright';

import { call, check, failureCount, newAdmin } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const one = (sql: string) => harnessQuery(sql)[0]?.[0];

async function textOf(page: Page, path: string) {
  await page.goto(`${FE}${path}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

void (async () => {
  const admin = await newAdmin('cp58-lock-admin');
  const spkB1 = Number(
    one(
      `select id from "SpeakingExercise" where "practiceSetId" = 'practice-pronunciation-b1' order by "order" limit 1`,
    ),
  );

  console.log('\n== FREE');
  const free = await studentPage('cp58-lock-free');
  await hidePet(free.page);
  const fl = await textOf(free.page, '/listening');
  check(
    'FREE Listening: B1+ says "Mở khóa với PLUS"',
    fl.includes('Mở khóa với PLUS'),
  );
  for (const path of ['/speaking', '/writing']) {
    const t = await textOf(free.page, path);
    check(
      `FREE ${path}: B1+ says "Mở khóa với PRO", never PLUS`,
      t.includes('Mở khóa với PRO') && !t.includes('Mở khóa với PLUS'),
    );
  }
  await free.browser.close();

  console.log('\n== PLUS');
  const plus = await studentPage('cp58-lock-plus');
  const planVersionId = Number(
    one(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and p.code = 'PLUS'`,
    ),
  );
  const g = await call('POST', '/admin/subscriptions/grant', admin.token, {
    studentId: plus.account.userId,
    planVersionId,
    durationDays: 30,
    reason: 'CP58 lock copy',
  });
  check('PLUS granted', g.status < 300, `(${g.status})`);
  await hidePet(plus.page);
  const pl = await textOf(plus.page, '/listening');
  check('PLUS Listening: nothing locked', !pl.includes('Mở khóa với'));
  const ps = await textOf(plus.page, '/speaking');
  check(
    'PLUS Speaking: B1+ says "Mở khóa với PRO", never PLUS',
    ps.includes('Mở khóa với PRO') && !ps.includes('Mở khóa với PLUS'),
  );
  await plus.page
    .getByRole('button', { name: /Mở khóa bài luyện nói/ })
    .first()
    .click();
  const dialog = plus.page.locator('[aria-labelledby="paywall-title"]');
  await dialog.waitFor({ timeout: 10_000 });
  const dt = (await dialog.innerText()).replace(/\s+/g, ' ');
  check(
    'PLUS Speaking paywall: "Xem gói PRO", no PLUS offer',
    dt.includes('Xem gói PRO') && !dt.includes('Xem gói PLUS'),
    dt.slice(0, 160),
  );
  await plus.page.screenshot({
    path: 'artifacts/qa-screens/cp58-plus-speaking-paywall.png',
  });
  await dialog.getByRole('button', { name: 'Để sau' }).click();
  const pw = await textOf(plus.page, '/writing');
  check(
    'PLUS Writing: B1+ says "Mở khóa với PRO", never PLUS',
    pw.includes('Mở khóa với PRO') && !pw.includes('Mở khóa với PLUS'),
  );
  const pd = await textOf(plus.page, `/speaking/${spkB1}`);
  check(
    'PLUS opening B1 Speaking directly: "Nội dung dành cho PRO"',
    pd.includes('Nội dung dành cho PRO') && pd.includes('Xem gói PRO'),
  );
  const wd = await textOf(plus.page, '/writing/18');
  check(
    'PLUS opening B1 Writing directly: "Nội dung dành cho PRO"',
    wd.includes('Nội dung dành cho PRO') && wd.includes('Xem gói PRO'),
  );
  // Locked detail pages answer 403 by design; only crashes and 5xx count.
  const crashes = plus.issues.filter((i) => !i.startsWith('console:'));
  check(
    'PLUS: no page errors or 5xx',
    crashes.length === 0,
    crashes.join(' | '),
  );
  await plus.browser.close();

  console.log('\n== PRO');
  const pro = await studentPage('cp58-lock-pro', 1440, true);
  await hidePet(pro.page);
  for (const path of ['/listening', '/reading', '/speaking', '/writing']) {
    const t = await textOf(pro.page, path);
    check(`PRO ${path}: nothing locked`, !t.includes('Mở khóa với'));
  }
  await pro.browser.close();

  console.log(`\nCP58_LOCK_COPY_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
