/**
 * 90- and 180-day plans on the disposable harness (fake PayOS, nothing reaches
 * payOS). The catalog lists 30/90/180 days for PLUS and PRO; a learner buys
 * PLUS 90 days and gets a 90-day plan at 186,000 VND; the PRO 180-day preview
 * offers an upgrade with converted days; the /plans page shows the term
 * picker with -10% / -20% and the 90-day price.
 *
 * Start the backend with: QA_PAYOS=fake finalization-harness.sh qa-backend <db>
 * and run `bootstrap:plans` on that database first.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/long-plans-browser.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/long-plans`;
const FAKE = 'http://127.0.0.1:9470';
const DAY = 86_400_000;

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const catalog = (await call('GET', '/plans/catalog')).data?.plans ?? [];
  const terms = (code: string) =>
    (catalog.find((p: any) => p.code === code)?.versions ?? []).map(
      (v: any) => [v.durationDays, v.priceVnd],
    );
  check(
    'PLUS sells 30/90/180 days at 69k/186k/331k',
    JSON.stringify(terms('PLUS')) ===
      JSON.stringify([
        [30, 69000],
        [90, 186000],
        [180, 331000],
      ]),
    JSON.stringify(terms('PLUS')),
  );
  check(
    'PRO sells 30/90/180 days at 149k/402k/715k',
    JSON.stringify(terms('PRO')) ===
      JSON.stringify([
        [30, 149000],
        [90, 402000],
        [180, 715000],
      ]),
    JSON.stringify(terms('PRO')),
  );
  const version = (code: string, days: number) =>
    catalog
      .find((p: any) => p.code === code)
      ?.versions?.find((v: any) => v.durationDays === days);
  check(
    'currentVersion stays the 30-day term for older clients',
    catalog.find((p: any) => p.code === 'PLUS')?.currentVersion
      ?.durationDays === 30,
  );

  const { browser, page, account } = await studentPage('long-plans', 1366);

  // Buy PLUS 90 days through the fake PayOS.
  const plus90 = version('PLUS', 90);
  const bought = await call('POST', '/plan-purchases', account.token, {
    planVersionId: plus90.id,
    idempotencyKey: randomUUID(),
  });
  check(
    'a PLUS 90-day purchase costs 186,000 VND for 90 days',
    bought.data?.amountVnd === 186000 && bought.data?.durationDays === 90,
    `(${bought.status} ${bought.data?.amountVnd} ${bought.data?.durationDays})`,
  );
  const intentId = bought.data?.payos?.intentId;
  const orderCode = harnessQuery(
    `select "orderCode" from "PayOSPaymentIntent" where id = ${Number(intentId)}`,
  )[0]?.[0];
  await fetch(`${FAKE}/__mock/pay/${orderCode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  await call('POST', `/payments/payos/${intentId}/sync`, account.token, {});
  const sub = harnessQuery(
    `select extract(epoch from ("endsAt" - "startsAt")) from "Subscription" where "userId" = ${account.userId} and "planPurchaseId" = ${Number(bought.data?.id)}`,
  )[0]?.[0];
  check(
    'payment activates a 90-day PLUS subscription',
    Math.round(Number(sub) / 86400) === 90,
    `(${sub})`,
  );

  const preview = await call(
    'GET',
    `/plan-purchases/renewal-preview/${version('PRO', 180).id}`,
    account.token,
  );
  check(
    'PRO 180 days while on PLUS 90: upgrade now with converted days',
    preview.data?.kind === 'UPGRADE' && Number(preview.data?.convertedDays) > 0,
    JSON.stringify(preview.data),
  );
  // 90 PLUS days at 186,000/90 against PRO at 715,000/180: about 46 days.
  const expected = Math.floor(90 * (186000 / 90 / (715000 / 180)));
  check(
    'converted days follow the daily-price ratio',
    Math.abs(Number(preview.data?.convertedDays) - expected) <= 1,
    `(${preview.data?.convertedDays} vs ${expected})`,
  );

  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${FE}/plans`);
    await hidePet(page);
    const picker = page.getByRole('radiogroup', { name: 'Thời hạn gói' });
    await picker.waitFor({ timeout: 60_000 });
    const pickerText = (await picker.innerText()).replace(/\s+/g, ' ');
    check(
      `${width}px: the picker offers 30, 90 (-10%) and 180 (-20%) days`,
      /30 ngày/.test(pickerText) &&
        /90 ngày\s*-10%/.test(pickerText) &&
        /180 ngày\s*-20%/.test(pickerText),
      pickerText,
    );
    await picker.getByRole('radio', { name: /90 ngày/ }).click();
    const body = (await page.locator('main').last().innerText()).replace(
      /\s+/g,
      ' ',
    );
    check(
      `${width}px: 90 days shows PLUS 186.000 ₫ and about 62.000 ₫ per 30 days`,
      /186\.000\s?₫ \/ 90 ngày/.test(body) &&
        /≈ 62\.000\s?₫ \/ 30 ngày/.test(body),
    );
    check(
      `${width}px: 90 days shows PRO 402.000 ₫`,
      /402\.000\s?₫ \/ 90 ngày/.test(body),
    );
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
      path: `${SHOTS}/plans-90-${width}.png`,
      fullPage: false,
    });
  }
  await browser.close();

  console.log(`\nLONG_PLANS_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
