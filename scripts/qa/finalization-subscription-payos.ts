/**
 * MOCK PROVIDER E2E — subscriptions and PayOS on the disposable harness.
 *
 * The harness backend runs with fake PayOS credentials and PAYOS_BASE_URL
 * pointing at scripts/qa/harness-fake-payos.ts (127.0.0.1:9470). Webhooks are
 * signed here with the documented algorithm (sorted key=value&…, HMAC-SHA256
 * with the checksum key). Nothing reaches payOS and no money moves; this does
 * NOT prove production PayOS connectivity.
 */
import { createHmac, randomUUID } from 'node:crypto';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const CHECKSUM = 'mock-checksum-key';
const FAKE = 'http://127.0.0.1:9470';
const one = (sql: string) => harnessQuery(sql)[0]?.[0];

/** payOS webhook signature, written from the docs (not the SDK). */
function sign(data: Record<string, unknown>, key = CHECKSUM) {
  const str = Object.keys(data)
    .sort()
    .map((k) => {
      const v = data[k];
      return `${k}=${v === null || v === undefined || v === 'null' || v === 'undefined' ? '' : Array.isArray(v) ? JSON.stringify(v) : String(v)}`;
    })
    .join('&');
  return createHmac('sha256', key).update(str).digest('hex');
}

function webhookData(
  orderCode: number,
  amount: number,
  paymentLinkId: string,
  code = '00',
) {
  return {
    orderCode,
    amount,
    description: `BT ${orderCode}`,
    accountNumber: '0000000000',
    reference: `REF${orderCode}`,
    transactionDateTime: '2026-10-28 10:00:00',
    currency: 'VND',
    paymentLinkId,
    code,
    desc: code === '00' ? 'success' : 'failed',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: '',
    counterAccountNumber: '',
    virtualAccountName: '',
    virtualAccountNumber: '',
  };
}
async function postWebhook(
  data: Record<string, unknown>,
  signature = sign(data),
) {
  const res = await fetch(`${BE}/api/payments/payos/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: '00',
      desc: 'success',
      success: true,
      data,
      signature,
    }),
  });
  return res.status;
}

const versions = Object.fromEntries(
  harnessQuery(
    `select p.code, pv.id, pv."priceVnd" from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and pv.status = 'PUBLISHED'`,
  ).map(([c, id, price]) => [c, { id: Number(id), price: Number(price) }]),
);
const plan = async (token: string) =>
  (await call('GET', '/subscriptions/me', token)).data;
const planCode = async (token: string) => {
  const p = await plan(token);
  return p?.planCode ?? p?.plan?.code ?? p?.code;
};

async function buy(token: string, code: 'PLUS' | 'PRO', key = randomUUID()) {
  const r = await call('POST', '/plan-purchases', token, {
    planVersionId: versions[code].id,
    idempotencyKey: key,
  });
  const intent = r.data?.payos;
  const row = intent
    ? harnessQuery(
        `select "orderCode", "paymentLinkId", id from "PayOSPaymentIntent" where id = ${intent.intentId}`,
      )[0]
    : null;
  return {
    status: r.status,
    purchaseId: r.data?.id as number,
    data: r.data,
    intentId: intent?.intentId as number,
    orderCode: row ? Number(row[0]) : 0,
    linkId: row?.[1] ?? '',
  };
}
const subs = (userId: number) =>
  harnessQuery(
    `select id, "endsAt", "planPurchaseId" from "Subscription" s where "userId" = ${userId} and exists (select 1 from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv.id = s."planVersionId" and p.code <> 'FREE')`,
  );

async function main() {
  console.log('\n== Catalog and FREE');
  const free = await newStudent('sub-free');
  const catalog = await call('GET', '/plans/catalog', free.token);
  const text = JSON.stringify(catalog.data);
  check(
    'catalog lists FREE 0, PLUS 69000, PRO 149000',
    catalog.status === 200 &&
      /PLUS/.test(text) &&
      /69000/.test(text) &&
      /149000/.test(text),
    `(${catalog.status})`,
  );
  check(
    'a new learner is on FREE',
    (await planCode(free.token)) === 'FREE',
    JSON.stringify(await plan(free.token)).slice(0, 120),
  );
  const premiumQuiz = Number(
    one(
      `select id from "Quiz" where "isPremiumContent" and type = 'BILINGUAL_READING' order by id limit 1`,
    ),
  );
  const proCourse = Number(
    one(
      `select id from "Course" where status = 'PUBLISHED' order by id limit 1`,
    ),
  );
  const quizAccess = async (t: string) =>
    (await call('GET', `/quizzes/${premiumQuiz}`, t)).status;
  const courseAccess = async (t: string) =>
    (await call('GET', `/courses/${proCourse}/learning`, t)).status;
  const fq = await quizAccess(free.token);
  const fc = await courseAccess(free.token);
  check(
    'FREE: premium reading quiz refused by the server',
    fq === 403,
    `(quiz ${premiumQuiz}: ${fq})`,
  );
  check(
    'FREE: course library refused by the server',
    fc === 403,
    `(course ${proCourse}: ${fc})`,
  );

  console.log('\n== PLUS purchase through the mock provider');
  const p = await newStudent('sub-plus');
  const key = randomUUID();
  const b = await buy(p.token, 'PLUS', key);
  check(
    'purchase created PENDING_PAYMENT at the server price 69000',
    b.status === 201 &&
      b.data.status === 'PENDING_PAYMENT' &&
      b.data.amountVnd === 69000,
    `(${b.status} ${b.data?.status} ${b.data?.amountVnd})`,
  );
  check(
    'checkout comes from the mock provider (link + QR)',
    String(b.data.payos?.checkoutUrl).startsWith(FAKE) &&
      Boolean(b.data.payos?.qrCode),
  );
  const again = await buy(p.token, 'PLUS', key);
  check(
    'same idempotency key → same purchase',
    again.purchaseId === b.purchaseId,
    `(${again.purchaseId} vs ${b.purchaseId})`,
  );
  const tamper = await call('POST', '/plan-purchases', p.token, {
    planVersionId: versions.PLUS.id,
    idempotencyKey: randomUUID(),
    amountVnd: 1000,
  });
  check(
    'a client-supplied amount is ignored or refused',
    tamper.status >= 400 || tamper.data?.amountVnd === 69000,
    `(${tamper.status} ${tamper.data?.amountVnd})`,
  );
  check('before payment: still FREE', (await planCode(p.token)) === 'FREE');

  const report = await call(
    'POST',
    `/plan-purchases/${b.purchaseId}/report-transfer`,
    p.token,
    {},
  );
  check(
    '"I have paid" from the learner does not activate',
    (await planCode(p.token)) === 'FREE',
    `(report ${report.status})`,
  );
  const syncEarly = await call(
    'POST',
    `/payments/payos/${b.intentId}/sync`,
    p.token,
    {},
  );
  check(
    'sync before the provider says PAID does not activate',
    (await planCode(p.token)) === 'FREE',
    `(${syncEarly.status} ${syncEarly.data?.status})`,
  );
  const ret = await fetch(
    `http://localhost:3100/hub?tab=account-plan&intent=${b.intentId}`,
  );
  check(
    'opening the return URL does not activate',
    ret.status < 500 && (await planCode(p.token)) === 'FREE',
    `(${ret.status})`,
  );

  console.log(
    '\n== Webhook negatives (all signed by the test, nothing activates)',
  );
  const good = webhookData(b.orderCode, 69000, b.linkId);
  const neg: Array<[string, number]> = [
    ['invalid signature', await postWebhook(good, sign(good, 'wrong-key'))],
    [
      'amount mismatch (1000)',
      await postWebhook(webhookData(b.orderCode, 1000, b.linkId)),
    ],
    [
      'payment link mismatch',
      await postWebhook(webhookData(b.orderCode, 69000, 'someone-elses-link')),
    ],
    [
      'failed payment (code 01)',
      await postWebhook(webhookData(b.orderCode, 69000, b.linkId, '01')),
    ],
  ];
  for (const [label, status] of neg)
    check(
      `${label}: rejected (${status}), still FREE`,
      status >= 400 && (await planCode(p.token)) === 'FREE',
    );
  const unknown = await postWebhook(webhookData(999_999_123, 69000, 'x'));
  check(
    'unknown order: acknowledged without effect',
    unknown === 200 && subs(p.userId).length === 0,
    `(${unknown})`,
  );

  console.log('\n== Valid webhook, duplicate');
  const okStatus = await postWebhook(good);
  const s1 = subs(p.userId);
  const days = s1.length
    ? Number(
        one(
          `select extract(epoch from ("endsAt" - "startsAt")) / 86400 from "Subscription" where id = ${s1[0][0]}`,
        ),
      )
    : 0;
  check(
    'valid signed webhook → PLUS active for 30 days',
    okStatus === 200 &&
      (await planCode(p.token)) === 'PLUS' &&
      s1.length === 1 &&
      Math.abs(days - 30) < 0.001,
    `(${okStatus}, ${days.toFixed(2)} d)`,
  );
  check(
    'purchase COMPLETED, intent PAID',
    one(`select status from "PlanPurchase" where id = ${b.purchaseId}`) ===
      'COMPLETED' &&
      one(
        `select status from "PayOSPaymentIntent" where id = ${b.intentId}`,
      ) === 'PAID',
  );
  const dup = await postWebhook(good);
  const s2 = subs(p.userId);
  check(
    'duplicate webhook: 200, no second subscription, same end date',
    dup === 200 && s2.length === 1 && s2[0][1] === s1[0][1],
    `(${dup}, ${s2.length})`,
  );
  check(
    'the FREE learner is untouched by this payment',
    (await planCode(free.token)) === 'FREE',
  );
  check(
    'PLUS: premium reading quiz opens',
    (await quizAccess(p.token)) === 200,
    `(${await quizAccess(p.token)})`,
  );
  check(
    'PLUS: course library still refused (PRO only)',
    (await courseAccess(p.token)) === 403,
    `(${await courseAccess(p.token)})`,
  );

  console.log('\n== PRO, five identical webhooks at once');
  const q = await newStudent('sub-pro');
  const bq = await buy(q.token, 'PRO');
  const data = webhookData(bq.orderCode, 149000, bq.linkId);
  const statuses = await Promise.all(
    Array.from({ length: 5 }, () => postWebhook(data)),
  );
  const sq = subs(q.userId);
  const events = one(
    `select count(*) from "SubscriptionEvent" e join "Subscription" s on s.id = e."subscriptionId" where s."userId" = ${q.userId} and e.type = 'PAYMENT_ACTIVATED'`,
  );
  check(
    '5 concurrent webhooks → exactly one subscription and one activation event',
    sq.length === 1 && events === '1',
    `(statuses ${statuses.join(',')}; subs ${sq.length}; events ${events})`,
  );
  check(
    'PRO: course library opens',
    (await courseAccess(q.token)) === 200,
    `(${await courseAccess(q.token)})`,
  );

  console.log('\n== Provider sync (signed provider record)');
  const r = await newStudent('sub-sync');
  const br = await buy(r.token, 'PLUS');
  await fetch(`${FAKE}/__mock/pay/${br.orderCode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountPaid: 1000 }),
  });
  await call('POST', `/payments/payos/${br.intentId}/sync`, r.token, {});
  check(
    'partly paid at the provider: sync does not activate',
    (await planCode(r.token)) === 'FREE',
  );
  await fetch(`${FAKE}/__mock/pay/${br.orderCode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const synced = await call(
    'POST',
    `/payments/payos/${br.intentId}/sync`,
    r.token,
    {},
  );
  check(
    'fully paid at the provider: sync activates PLUS',
    (await planCode(r.token)) === 'PLUS',
    `(${synced.status} ${synced.data?.status})`,
  );

  console.log('\n== Ownership');
  const foreignPurchase = await call(
    'GET',
    `/plan-purchases/${b.purchaseId}`,
    free.token,
  );
  const foreignIntent = await call(
    'GET',
    `/payments/payos/${b.intentId}`,
    free.token,
  );
  const foreignSync = await call(
    'POST',
    `/payments/payos/${b.intentId}/sync`,
    free.token,
    {},
  );
  const foreignCancel = await call(
    'POST',
    `/payments/payos/${bq.intentId}/cancel`,
    free.token,
    {},
  );
  check(
    "another learner cannot read, sync or cancel someone else's payment",
    [foreignPurchase, foreignIntent, foreignSync, foreignCancel].every(
      (x) => x.status === 403 || x.status === 404,
    ),
    `(${[foreignPurchase, foreignIntent, foreignSync, foreignCancel].map((x) => x.status).join(',')})`,
  );

  console.log('\n== Expiry');
  harnessExec(
    `update "Subscription" set "startsAt" = now() - interval '31 days', "endsAt" = now() - interval '1 minute' where "userId" = ${q.userId}`,
  );
  check(
    'expired PRO: back to FREE, course refused',
    (await planCode(q.token)) === 'FREE' &&
      (await courseAccess(q.token)) === 403,
    `(${await courseAccess(q.token)})`,
  );

  console.log('\n== Cancellation');
  const c = await newStudent('sub-cancel');
  const bc = await buy(c.token, 'PLUS');
  const cancel = await call(
    'POST',
    `/payments/payos/${bc.intentId}/cancel`,
    c.token,
    {},
  );
  const lateWebhook = await postWebhook(
    webhookData(bc.orderCode, 69000, bc.linkId, '01'),
  );
  check(
    'cancelled link: intent CANCELLED, failed webhook refused, still FREE',
    cancel.status === 200 &&
      one(
        `select status from "PayOSPaymentIntent" where id = ${bc.intentId}`,
      ) === 'CANCELLED' &&
      lateWebhook >= 400 &&
      (await planCode(c.token)) === 'FREE',
    `(${cancel.status}, ${lateWebhook})`,
  );

  const calls: Array<{ authorized: boolean }> = await (
    await fetch(`${FAKE}/__mock/requests`)
  ).json();
  check(
    'every provider call reached the mock with the harness credentials',
    calls.length > 0 && calls.every((x) => x.authorized),
    `(${calls.length} calls)`,
  );
  console.log(`\nSUBSCRIPTION_PAYOS_MOCK_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
