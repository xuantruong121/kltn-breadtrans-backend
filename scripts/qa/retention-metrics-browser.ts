/**
 * The admin retention page (/admin/retention) against GET
 * /admin/retention-metrics, on the disposable harness.
 *
 * Fixture: a learner signed up 40 days ago who learned again on day 31, so
 * their signup week must show a day-30 hit. A learner cannot read the figures.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/retention-metrics-browser.ts
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { FE, hidePet } from './harness-browser';
import { harnessExec } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/retention`;
const DAY = 86_400_000;

function vnWeekStart(date: Date): string {
  const day = Math.floor((date.getTime() + 7 * 3_600_000) / DAY);
  return new Date((day - ((day + 3) % 7)) * DAY).toISOString().slice(0, 10);
}

function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * DAY);
  const dm = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${dm(start)} – ${dm(end)}`;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const signup = new Date(Date.now() - 40 * DAY);
  const learner = await newStudent('retention');
  harnessExec(
    `update "User" set "createdAt" = '${signup.toISOString()}' where id = ${learner.userId};
     insert into "LearningActivity" ("userId", type, title, "occurredAt")
     values (${learner.userId}, 'QA', 'retention fixture', '${new Date(signup.getTime() + 31 * DAY).toISOString()}');`,
  );

  const denied = await call('GET', '/admin/retention-metrics', learner.token);
  check(
    'a learner cannot read the figures',
    denied.status === 403,
    String(denied.status),
  );

  const admin = await newAdmin('retention-admin');
  const res = await call(
    'GET',
    '/admin/retention-metrics?weeks=12',
    admin.token,
  );
  check('admin reads the figures', res.status === 200, String(res.status));
  const week = vnWeekStart(signup);
  const row = res.data?.cohorts?.find((c: any) => c.weekStart === week);
  check('the fixture week is listed', !!row, week);
  check(
    'the fixture counts as a day-30 hit',
    row?.d30?.hits >= 1 && row?.d30?.eligible >= row?.d30?.hits,
    JSON.stringify(row?.d30),
  );
  check(
    'every ended plan has a final early figure',
    (res.data?.renewals ?? []).every((r: any) => r.early.eligible === r.ended),
  );
  check(
    'streak share stays within its base',
    res.data?.streak?.hits <= res.data?.streak?.eligible,
    JSON.stringify(res.data?.streak),
  );

  const browser = await chromium.launch();
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${FE}/login`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.click('button[aria-controls="email-login-panel"]');
    await page.fill('input[name="email"]', admin.email);
    await page.fill('input[name="password"]', admin.password);
    await page.click('#email-login-panel button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 60_000,
      waitUntil: 'commit',
    });
    await page.goto(`${FE}/admin/retention`);
    await hidePet(page);
    await page
      .getByRole('heading', { name: 'Quay lại học theo tuần đăng ký' })
      .waitFor({ timeout: 60_000 });
    const text = await page.locator('main').last().innerText();
    const pct =
      row?.d30?.rate == null ? '' : `${Math.round(row.d30.rate * 100)}%`;
    check(
      `${width}px: the fixture week is shown`,
      text.includes(weekLabel(week)),
      weekLabel(week),
    );
    check(
      `${width}px: its day-30 figure matches the API`,
      !!pct && text.includes(pct),
      pct,
    );
    check(
      `${width}px: the renewal table is shown`,
      text.includes('Gia hạn theo tuần hết hạn'),
    );
    if (width === 1366) {
      const refetch = page.waitForResponse((r) =>
        r.url().includes('retention-metrics?weeks=4'),
      );
      await page.getByRole('button', { name: '4 tuần' }).click();
      check('the 4-week button refetches', (await refetch).ok());
      await page.getByRole('button', { name: '12 tuần' }).click();
      await page
        .getByRole('heading', { name: 'Quay lại học theo tuần đăng ký' })
        .waitFor({ timeout: 60_000 });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    check(
      `${width}px: no sideways page scroll`,
      overflow <= 0,
      String(overflow),
    );
    await page.screenshot({
      path: `${SHOTS}/retention-${width}.png`,
      fullPage: true,
    });
    await page.close();
  }
  await browser.close();

  const failed = failureCount();
  console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
