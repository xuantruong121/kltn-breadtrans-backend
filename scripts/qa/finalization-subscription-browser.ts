/**
 * MOCK PROVIDER E2E in Chromium (harness, fake PayOS on :9470).
 * A FREE learner buys PRO on /plans, sees the mock checkout, returns through
 * the PayOS return URL (still not active), then a signed webhook settles the
 * order and the page shows PRO. No real payOS call, no money.
 */
import { createHmac } from 'node:crypto';

import { BE, call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';
const sign = (data: Record<string, unknown>) =>
  createHmac('sha256', 'mock-checksum-key')
    .update(
      Object.keys(data)
        .sort()
        .map((k) => `${k}=${String(data[k] ?? '')}`)
        .join('&'),
    )
    .digest('hex');

async function main() {
  const { browser, page, account, issues } = await studentPage('sub-ui', 1366);
  await hidePet(page);
  const code = async () => {
    const p = (await call('GET', '/subscriptions/me', account.token)).data;
    return p?.plan?.code;
  };
  await page.goto(`${FE}/plans`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.screenshot({
    path: `${SHOTS}/plans-free-1366.png`,
    fullPage: true,
  });
  await page.locator('button.bg-indigo-600').first().click();
  const modal = page.locator('[role="dialog"][aria-modal="true"]');
  await modal.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  let body = (await modal.innerText()).replace(/\s+/g, ' ');
  check(
    'checkout modal is for the plan chosen (PRO), not a fixed PLUS title',
    /Thanh toán BreadTrans Pro/.test(body) && !/BreadTrans Plus/.test(body),
    body.slice(0, 120),
  );
  check('modal shows the mock amount 149.000', /149[.,]000/.test(body));
  await page.screenshot({ path: `${SHOTS}/plans-checkout-pro-mock-1366.png` });
  const intent = harnessQuery(
    `select i.id, i."orderCode", i."paymentLinkId", i."amountVnd" from "PayOSPaymentIntent" i where i."userId" = ${account.userId} order by i.id desc limit 1`,
  )[0];
  check(
    'a PENDING intent exists, learner still FREE',
    Boolean(intent) && (await code()) === 'FREE',
  );

  await page.goto(`${FE}/hub?tab=account-plan&intent=${intent[0]}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(3000);
  body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'return URL page does not claim success and the server keeps FREE',
    !/Thanh toán thành công/.test(body) && (await code()) === 'FREE',
  );
  await page.screenshot({ path: `${SHOTS}/plans-return-pending-1366.png` });

  const data = {
    orderCode: Number(intent[1]),
    amount: Number(intent[3]),
    description: 'BT',
    accountNumber: '0000000000',
    reference: 'REF',
    transactionDateTime: '2026-10-28 10:00:00',
    currency: 'VND',
    paymentLinkId: intent[2],
    code: '00',
    desc: 'success',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: '',
    counterAccountNumber: '',
    virtualAccountName: '',
    virtualAccountNumber: '',
  };
  const res = await fetch(`${BE}/api/payments/payos/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: '00',
      desc: 'success',
      success: true,
      data,
      signature: sign(data),
    }),
  });
  check('signed webhook accepted', res.status === 200, `(${res.status})`);
  check('server plan is PRO', (await code()) === 'PRO');
  await page.goto(`${FE}/plans`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2500);
  body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'plans page reflects PRO after a reload',
    /Pro/.test(body) && /(Đang dùng|Gói hiện tại|đang sử dụng)/i.test(body),
    body.slice(0, 160),
  );
  await page.screenshot({
    path: `${SHOTS}/plans-pro-active-1366.png`,
    fullPage: true,
  });
  const course = Number(
    harnessQuery(
      `select id from "Course" where status = 'PUBLISHED' order by id limit 1`,
    )[0][0],
  );
  await page.goto(`${FE}/courses/${course}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  check(
    'PRO course detail opens in the browser',
    !(await page.locator('body').innerText()).includes('Nâng cấp lên PRO'),
  );
  check(
    'no server or page error',
    !issues.some((x) => x.startsWith('api 5') || x.startsWith('pageerror')),
    issues
      .filter((x) => !x.includes('GSI') && !x.includes('403'))
      .join(' | ')
      .slice(0, 200),
  );
  await browser.close();
  console.log(`\nSUBSCRIPTION_BROWSER_MOCK_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
