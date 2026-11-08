/**
 * The 7-day Plus card (owner 2026-11-08, in place of the Phúc Long voucher),
 * bought through the shop page of the harness frontend:
 *   A, no plan: one card starts 7 days of Plus at once (no shipping form, no
 *     admin approval); a second card extends that term to 14 days.
 *   B, a 30-day plan granted by an admin (PRO): one card adds 7 days to it.
 * Runs against the disposable harness only (FE :3100, BE :3101, harness-pg
 * database HARNESS_DB, which must hold product 10 as plus-7d and migration
 * 20261108160000_market_plus_card).
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-market-plus-card.ts
 */
import type { Page } from 'playwright';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const WIDTH = Number(process.env.SHOP_WIDTH ?? 1366);
const DAY = 24 * 60 * 60 * 1000;

const bread = (u: number) =>
  Number(
    harnessQuery(
      `select coalesce(max("totalBanhRan"),0) from "UserStats" where "userId" = ${u}`,
    )[0][0],
  );
const fund = (u: number, amount: number) =>
  harnessExec(
    `insert into "UserStats" ("userId","totalBanhRan") values (${u}, ${amount}) on conflict ("userId") do update set "totalBanhRan" = ${amount}`,
  );
const terms = (u: number) =>
  harnessQuery(
    `select s.id, s.source, p.code, extract(epoch from (s."endsAt" - s."startsAt")) * 1000, extract(epoch from (s."endsAt" - now())) * 1000
     from "Subscription" s join "PlanVersion" v on v.id = s."planVersionId" join "Plan" p on p.id = v."planId"
     where s."userId" = ${u} and s.status = 'ACTIVE' and s."endsAt" > now() order by s.id`,
  ).map((r) => ({
    id: Number(r[0]),
    source: r[1],
    plan: r[2],
    lengthMs: Number(r[3]),
    leftMs: Number(r[4]),
  }));
const near = (ms: number, days: number) =>
  Math.abs(ms - days * DAY) < 60 * 60 * 1000;

async function buyCard(page: Page) {
  await page.goto(`${FE}/market`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await hidePet(page);
  const buy = page.locator(
    "xpath=//*[normalize-space(text())='Thẻ 7 ngày Plus']/ancestor::div[.//button[normalize-space()='Mua ngay']][1]//button[normalize-space()='Mua ngay']",
  );
  await buy.first().waitFor({ timeout: 30_000 });
  await buy.first().click();
  await page.getByRole('button', { name: /^Đổi với 2\.000 Bánh Mì/ }).click();
  return page
    .getByText(/Đổi "Thẻ 7 ngày Plus" thành công|thành công/)
    .first()
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
}

async function main() {
  const A = await studentPage('plus-card-a', WIDTH);
  fund(A.account.userId, 4100);
  await A.page.goto(`${FE}/market`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await hidePet(A.page);
  const cardText = (await A.page.locator('body').innerText()).replace(
    /\s+/g,
    ' ',
  );
  check(
    'the shop lists "Thẻ 7 ngày Plus" and no Phúc Long voucher',
    cardText.includes('Thẻ 7 ngày Plus') && !/Phúc Long/i.test(cardText),
  );
  await A.page
    .locator(
      "xpath=//*[normalize-space(text())='Thẻ 7 ngày Plus']/ancestor::div[.//button[normalize-space()='Mua ngay']][1]",
    )
    .first()
    .screenshot({ path: `${SHOTS}/market-plus-card-${WIDTH}.png` });

  check('A buys one card', await buyCard(A.page));
  await A.page.waitForTimeout(1000);
  await A.page.screenshot({
    path: `${SHOTS}/market-plus-card-bought-${WIDTH}.png`,
  });
  let t = terms(A.account.userId);
  check(
    'A: 2.000 Bánh Mì taken, one 7-day PLUS term from the shop',
    bread(A.account.userId) === 2100 &&
      t.length === 1 &&
      t[0].source === 'MARKET' &&
      t[0].plan === 'PLUS' &&
      near(t[0].lengthMs, 7),
    JSON.stringify({ bread: bread(A.account.userId), t }),
  );
  const orderA = harnessQuery(
    `select status from "MarketOrder" where "userId" = ${A.account.userId} order by id`,
  ).map((r) => r[0]);
  check(
    'A: the order is approved at once (no admin step, no shipping form)',
    orderA.length === 1 && orderA[0] === 'approved',
    JSON.stringify(orderA),
  );
  const notice = harnessQuery(
    `select title from "Notification" where "userId" = ${A.account.userId} and type like 'market_plus:%'`,
  );
  check(
    'A: a notification says 7 more days',
    notice.length === 1 && notice[0][0] === 'Bạn được thêm 7 ngày học',
    JSON.stringify(notice),
  );

  check('A buys a second card', await buyCard(A.page));
  await A.page.waitForTimeout(1000);
  t = terms(A.account.userId);
  check(
    'A: the same term now runs 14 days, nothing overlaps',
    bread(A.account.userId) === 100 &&
      t.length === 1 &&
      near(t[0].lengthMs, 14),
    JSON.stringify({ bread: bread(A.account.userId), t }),
  );
  const events = harnessQuery(
    `select e.type, e.metadata->>'placement' from "SubscriptionEvent" e join "Subscription" s on s.id = e."subscriptionId" where s."userId" = ${A.account.userId} order by e.id`,
  );
  check(
    'A: history MARKET_REWARD GRANT then EXTEND',
    JSON.stringify(events) ===
      JSON.stringify([
        ['MARKET_REWARD', 'GRANT'],
        ['MARKET_REWARD', 'EXTEND'],
      ]),
    JSON.stringify(events),
  );

  const B = await studentPage('plus-card-b', WIDTH, true);
  fund(B.account.userId, 2000);
  const before = terms(B.account.userId);
  // The harness grant (admin API) records a 30-day PRO term.
  check(
    'B starts with one 30-day paid plan',
    before.length === 1 &&
      before[0].source !== 'TRIAL' &&
      near(before[0].lengthMs, 30),
    JSON.stringify(before),
  );
  check('B buys one card', await buyCard(B.page));
  await B.page.waitForTimeout(1000);
  const after = terms(B.account.userId);
  check(
    'B: that plan is 7 days longer, no new term',
    after.length === 1 &&
      after[0].id === before[0].id &&
      near(after[0].leftMs - before[0].leftMs, 7),
    JSON.stringify({ before, after }),
  );

  for (const s of [A, B]) {
    check(
      `${s === A ? 'A' : 'B'}: no server or page error`,
      s.issues.length === 0,
      s.issues.join(' | '),
    );
    await s.browser.close();
  }
  console.log(`\nMARKET_PLUS_CARD_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
