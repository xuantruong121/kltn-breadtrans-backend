/**
 * Promo codes and win-back on the disposable harness (fake PayOS; nothing
 * reaches payOS and no money moves).
 *
 * - An admin code (20%, PLUS only, once per learner) previews at 56,000 for
 *   PLUS 30 days, is refused for PRO, and a purchase with it pays 56,000,
 *   records a redemption and shows in the admin list; the same learner
 *   cannot use it twice; a switched-off code is refused.
 * - The win-back job, 3 days after a bought plan ended, gives that learner a
 *   personal 20% code for 7 days with a notification; a rerun sends nothing
 *   new; another learner cannot use the personal code.
 *
 * Start the backend with: QA_PAYOS=fake finalization-harness.sh qa-backend <db>
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/promo-codes-api.ts
 */
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const FAKE = 'http://127.0.0.1:9470';
const REDIS = { host: '127.0.0.1', port: 6392 };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const dayKey = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const versionId = (code: string) =>
  Number(
    harnessQuery(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and pv.status = 'PUBLISHED' and coalesce(pv."durationDays", 30) = 30 and p.code = '${code}'`,
    )[0]?.[0],
  );

async function buyAndPay(token: string, code: string, promoCode?: string) {
  const r = await call('POST', '/plan-purchases', token, {
    planVersionId: versionId(code),
    idempotencyKey: randomUUID(),
    ...(promoCode ? { promoCode } : {}),
  });
  if (r.status >= 300)
    return { status: r.status, data: r.data, message: r.message };
  const intentId = r.data?.payos?.intentId;
  const orderCode = harnessQuery(
    `select "orderCode" from "PayOSPaymentIntent" where id = ${Number(intentId)}`,
  )[0]?.[0];
  await fetch(`${FAKE}/__mock/pay/${orderCode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  await call('POST', `/payments/payos/${intentId}/sync`, token, {});
  return { status: r.status, data: r.data, message: r.message };
}

async function runWinback(queue: Queue, suffix: string) {
  const job = await queue.add(
    'winback',
    { version: 1, dayKey },
    { jobId: `winback-${dayKey}-qa-${suffix}-${Date.now()}` },
  );
  for (let i = 0; i < 60; i += 1) {
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return state;
    await sleep(1000);
  }
  return 'timeout';
}

async function main() {
  const admin = await newAdmin('promo-admin');
  const code = `QA-${randomUUID().slice(0, 6).toUpperCase()}`;
  const created = await call('POST', '/admin/promo-codes', admin.token, {
    code: code.toLowerCase(),
    percentOff: 20,
    planCodes: ['PLUS'],
    note: 'harness',
  });
  check(
    'admin creates a code (stored upper-case)',
    created.status === 201 && created.data?.code === code,
    `(${created.status} ${created.data?.code})`,
  );
  const dup = await call('POST', '/admin/promo-codes', admin.token, {
    code,
    percentOff: 10,
  });
  check('a duplicate code is refused', dup.status === 409, `(${dup.status})`);

  const a = await newStudent('promo-a');
  const forbidden = await call('POST', '/admin/promo-codes', a.token, {
    code: 'X-1',
    percentOff: 10,
  });
  check(
    'a learner cannot create codes',
    forbidden.status === 403,
    `(${forbidden.status})`,
  );

  const preview = await call(
    'GET',
    `/plan-purchases/promo-preview?planVersionId=${versionId('PLUS')}&code=${code.toLowerCase()}`,
    a.token,
  );
  check(
    'preview: PLUS 30 days at 69,000 - 13,000 = 56,000',
    preview.data?.valid === true &&
      preview.data?.listPriceVnd === 69000 &&
      preview.data?.discountVnd === 13000 &&
      preview.data?.amountVnd === 56000,
    JSON.stringify(preview.data),
  );
  const wrongPlan = await call(
    'GET',
    `/plan-purchases/promo-preview?planVersionId=${versionId('PRO')}&code=${code}`,
    a.token,
  );
  check(
    'preview: the code does not apply to PRO',
    wrongPlan.data?.valid === false &&
      /không áp dụng/.test(wrongPlan.data?.message ?? ''),
    JSON.stringify(wrongPlan.data),
  );

  const bought = await buyAndPay(a.token, 'PLUS', code);
  check(
    'a purchase with the code pays 56,000',
    bought.data?.amountVnd === 56000 &&
      bought.data?.listPriceVnd === 69000 &&
      bought.data?.discountVnd === 13000 &&
      bought.data?.promoCode === code,
    JSON.stringify({
      s: bought.status,
      a: bought.data?.amountVnd,
      d: bought.data?.discountVnd,
    }),
  );
  const intentAmount = harnessQuery(
    `select "amountVnd" from "PayOSPaymentIntent" where id = ${Number(bought.data?.payos?.intentId)}`,
  )[0]?.[0];
  check(
    'the PayOS payment asks for 56,000',
    Number(intentAmount) === 56000,
    `(${intentAmount})`,
  );
  const redeemed = harnessQuery(
    `select count(*) from "PromoRedemption" r join "PromoCode" c on c.id = r."promoCodeId" where c.code = '${code}' and r."userId" = ${a.userId} and r."discountVnd" = 13000`,
  )[0]?.[0];
  check('payment records one redemption', redeemed === '1', `(${redeemed})`);
  const plan = (await call('GET', '/subscriptions/me', a.token)).data;
  check(
    'the learner is on PLUS',
    (plan?.planCode ?? plan?.plan?.code ?? plan?.code) === 'PLUS',
    JSON.stringify(plan).slice(0, 120),
  );

  const list = await call('GET', '/admin/promo-codes', admin.token);
  const row = (list.data ?? []).find((p: any) => p.code === code);
  check(
    'the admin list shows 1 use and 13,000 given',
    row?.redemptions === 1 && row?.discountGivenVnd === 13000,
    JSON.stringify(row),
  );

  const again = await call('POST', '/plan-purchases', a.token, {
    planVersionId: versionId('PLUS'),
    idempotencyKey: randomUUID(),
    promoCode: code,
  });
  check(
    'the same learner cannot use it twice',
    again.status === 400 && /đã dùng/.test(String(again.message)),
    `(${again.status} ${again.message})`,
  );

  await call('PATCH', `/admin/promo-codes/${row?.id}`, admin.token, {
    active: false,
  });
  const b = await newStudent('promo-b');
  const off = await call(
    'GET',
    `/plan-purchases/promo-preview?planVersionId=${versionId('PLUS')}&code=${code}`,
    b.token,
  );
  check(
    'a switched-off code is refused',
    off.data?.valid === false && /ngừng/.test(off.data?.message ?? ''),
    JSON.stringify(off.data),
  );

  // Win-back: C bought PLUS, which ended three Vietnam days ago.
  const c = await newStudent('promo-c');
  const cBought = await buyAndPay(c.token, 'PLUS');
  const subId = harnessQuery(
    `select id from "Subscription" where "planPurchaseId" = ${Number(cBought.data?.id)}`,
  )[0]?.[0];
  harnessExec(
    `update "Subscription" set "startsAt" = ('${dayKey}'::date - 33 + time '15:00') at time zone 'Asia/Ho_Chi_Minh', "endsAt" = ('${dayKey}'::date - 3 + time '15:00') at time zone 'Asia/Ho_Chi_Minh' where id = ${Number(subId)};
     update "PlanPurchase" set "completedAt" = ('${dayKey}'::date - 33 + time '15:00') at time zone 'Asia/Ho_Chi_Minh' where id = ${Number(cBought.data?.id)};`,
  );
  const queue = new Queue('breadtrans-system-jobs', { connection: REDIS });
  const state = await runWinback(queue, 'first');
  check('the win-back job completed', state === 'completed', `(${state})`);
  const offers = harnessQuery(
    `select type, body, url from "Notification" where "userId" = ${c.userId} and type like 'winback:%'`,
  );
  check(
    'C gets one win-back notification for that plan',
    offers.length === 1 && offers[0][0] === `winback:${subId}`,
    JSON.stringify(offers),
  );
  const personal = harnessQuery(
    `select code, "percentOff", source, "maxRedemptions", round(extract(epoch from ("validTo" - now())) / 86400) from "PromoCode" where "userId" = ${c.userId}`,
  );
  check(
    'C gets a personal 20% WINBACK code for 7 days, one use',
    personal.length === 1 &&
      /^QUAYLAI-[A-Z2-9]{6}$/.test(personal[0][0]) &&
      personal[0][1] === '20' &&
      personal[0][2] === 'WINBACK' &&
      personal[0][3] === '1' &&
      personal[0][4] === '7',
    JSON.stringify(personal),
  );
  const cCode = personal[0]?.[0] ?? '';
  check(
    'the message carries the code and links to /plans',
    (offers[0]?.[1] ?? '').includes(cCode) &&
      offers[0]?.[2] === `/plans?promo=${cCode}`,
    offers[0]?.[2],
  );
  const rerun = await runWinback(queue, 'again');
  const count = harnessQuery(
    `select count(*) from "Notification" where "userId" = ${c.userId} and type like 'winback:%'`,
  )[0]?.[0];
  const codes = harnessQuery(
    `select count(*) from "PromoCode" where "userId" = ${c.userId}`,
  )[0]?.[0];
  check(
    'a rerun sends nothing new',
    rerun === 'completed' && count === '1' && codes === '1',
    `(${rerun} ${count} ${codes})`,
  );
  await queue.close();

  const stolen = await call(
    'GET',
    `/plan-purchases/promo-preview?planVersionId=${versionId('PRO')}&code=${cCode}`,
    b.token,
  );
  check(
    'another learner cannot use the personal code',
    stolen.data?.valid === false &&
      /tài khoản khác/.test(stolen.data?.message ?? ''),
    JSON.stringify(stolen.data),
  );
  const own = await call(
    'GET',
    `/plan-purchases/promo-preview?planVersionId=${versionId('PRO')}&code=${cCode}`,
    c.token,
  );
  check(
    'C can use it on PRO: 149,000 - 29,000 = 120,000',
    own.data?.valid === true && own.data?.amountVnd === 120000,
    JSON.stringify(own.data),
  );

  console.log(`\nPROMO_CODES_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
