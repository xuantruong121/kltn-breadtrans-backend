/**
 * The five-minute sweep that closes unpaid purchases, on the disposable
 * harness with the fake PayOS (nothing reaches payOS and no money moves).
 *
 * - A new PayOS link carries the purchase's payment window as its expiry.
 * - Unpaid and past its window: the link is cancelled at PayOS, then the
 *   purchase and payment become EXPIRED; the learner can buy again.
 * - Paid at PayOS but never synced (no webhook): the sweep finds it paid and
 *   confirms it; the learner gets the plan.
 * - Still inside its window: untouched.
 * - A signed webhook for a purchase that had already expired: the payment
 *   becomes REVIEW_REQUIRED instead of being refused; an admin confirms it
 *   and the learner gets the plan.
 *
 * The sweep runs on the backend's own cron, so this waits for one tick.
 *
 * Start the backend with: QA_PAYOS=fake finalization-harness.sh qa-backend <db>
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/stale-purchase-sweep-api.ts
 */
import { randomUUID } from 'node:crypto';

import {
  BE,
  call,
  check,
  failureCount,
  newAdmin,
  newStudent,
} from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NodeCryptoProvider } = require('@payos/node/lib/crypto/node-crypto');

const FAKE = 'http://127.0.0.1:9470';
const CHECKSUM = 'mock-checksum-key';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const plusVersion = Number(
  harnessQuery(
    `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and pv.status = 'PUBLISHED' and coalesce(pv."durationDays", 30) = 30 and p.code = 'PLUS'`,
  )[0]?.[0],
);

type Bought = {
  purchaseId: number;
  orderCode: string;
  intentId: number;
  amount: number;
};

async function buy(token: string): Promise<Bought> {
  const r = await call('POST', '/plan-purchases', token, {
    planVersionId: plusVersion,
    idempotencyKey: randomUUID(),
  });
  if (r.status >= 300) throw new Error(`purchase ${r.status}`);
  const intentId = Number(r.data?.payos?.intentId);
  const [orderCode, purchaseId, amount] = harnessQuery(
    `select i."orderCode", p."planPurchaseId", i."amountVnd" from "PayOSPaymentIntent" i join "PlanPayment" p on p.id = i."planPaymentId" where i.id = ${intentId}`,
  )[0];
  return {
    purchaseId: Number(purchaseId),
    orderCode,
    intentId,
    amount: Number(amount),
  };
}

const state = (purchaseId: number) => {
  const [purchase, payment, intent] = harnessQuery(
    `select pp.status, p.status, coalesce(i.status::text, '') from "PlanPurchase" pp join "PlanPayment" p on p."planPurchaseId" = pp.id left join "PayOSPaymentIntent" i on i."planPaymentId" = p.id where pp.id = ${purchaseId}`,
  )[0];
  return { purchase, payment, intent };
};

const activeSubscriptions = (purchaseId: number) =>
  Number(
    harnessQuery(
      `select count(*) from "Subscription" where "planPurchaseId" = ${purchaseId} and status = 'ACTIVE'`,
    )[0]?.[0],
  );

const fakeLink = async (orderCode: string) =>
  (await fetch(`${FAKE}/__mock/link/${orderCode}`)).json();

const payAtPayos = (orderCode: string) =>
  fetch(`${FAKE}/__mock/pay/${orderCode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

const backdate = (purchaseId: number) =>
  harnessExec(
    `update "PlanPayment" set "paymentIntentExpiresAt" = now() - interval '20 minutes' where "planPurchaseId" = ${purchaseId}`,
  );

async function signedWebhook(b: Bought) {
  const link = await fakeLink(b.orderCode);
  const data = {
    orderCode: Number(b.orderCode),
    amount: b.amount,
    description: link.description,
    accountNumber: '0000000000',
    reference: `QA${b.orderCode}`,
    transactionDateTime: new Date().toISOString(),
    currency: 'VND',
    paymentLinkId: link.id,
    code: '00',
    desc: 'success',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: '',
    counterAccountNumber: '',
    virtualAccountName: '',
    virtualAccountNumber: '',
  };
  const signature = await new NodeCryptoProvider().createSignatureFromObj(
    data,
    CHECKSUM,
  );
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

async function main() {
  const admin = await newAdmin('sweep-admin');
  const unpaid = await newStudent('sweep-unpaid');
  const paid = await newStudent('sweep-paid');
  const fresh = await newStudent('sweep-fresh');
  const late = await newStudent('sweep-late');

  const a = await buy(unpaid.token);
  const linkA = await fakeLink(a.orderCode);
  const windowA = Number(
    harnessQuery(
      `select extract(epoch from "paymentIntentExpiresAt") from "PlanPayment" where "planPurchaseId" = ${a.purchaseId}`,
    )[0]?.[0],
  );
  check(
    'a new PayOS link expires with the purchase payment window',
    typeof linkA.expiredAt === 'number' &&
      Math.abs(linkA.expiredAt - windowA) <= 1,
    `link=${linkA.expiredAt} window=${Math.floor(windowA)}`,
  );

  const b = await buy(paid.token);
  await payAtPayos(b.orderCode);
  const d = await buy(fresh.token);

  // Already expired before the money arrives (a webhook delayed past the
  // window, or a purchase closed by a newer one).
  const e = await buy(late.token);
  harnessExec(
    `update "PlanPayment" set status = 'EXPIRED' where "planPurchaseId" = ${e.purchaseId}; update "PlanPurchase" set status = 'EXPIRED' where id = ${e.purchaseId}`,
  );
  await payAtPayos(e.orderCode);
  const hook = await signedWebhook(e);
  const eHeld = state(e.purchaseId);
  check(
    'a webhook for an expired purchase is acknowledged',
    hook === 200,
    `HTTP ${hook}`,
  );
  check(
    'that payment waits for an admin (REVIEW_REQUIRED, purchase EXPIRED)',
    eHeld.payment === 'REVIEW_REQUIRED' && eHeld.purchase === 'EXPIRED',
    JSON.stringify(eHeld),
  );
  check(
    'no plan is granted before the admin decides',
    activeSubscriptions(e.purchaseId) === 0,
  );
  const listed = await call(
    'GET',
    `/admin/plan-purchases/${e.purchaseId}`,
    admin.token,
  );
  check(
    'the admin sees it as REVIEW_REQUIRED',
    listed.data?.payment?.status === 'REVIEW_REQUIRED',
    String(listed.data?.payment?.status),
  );
  const confirmed = await call(
    'POST',
    `/admin/plan-purchases/${e.purchaseId}/confirm`,
    admin.token,
    {},
  );
  check(
    'the admin confirms it and the learner gets the plan',
    confirmed.status < 300 &&
      state(e.purchaseId).purchase === 'COMPLETED' &&
      activeSubscriptions(e.purchaseId) === 1,
    `HTTP ${confirmed.status} ${JSON.stringify(state(e.purchaseId))}`,
  );

  backdate(a.purchaseId);
  backdate(b.purchaseId);
  console.log('waiting for the sweep (cron every five minutes)...');
  const deadline = Date.now() + 7 * 60_000;
  while (Date.now() < deadline) {
    if (
      state(a.purchaseId).purchase !== 'PENDING_PAYMENT' &&
      state(b.purchaseId).purchase !== 'PENDING_PAYMENT'
    )
      break;
    await sleep(10_000);
  }

  const aAfter = state(a.purchaseId);
  check(
    'an unpaid purchase past its window is expired',
    aAfter.purchase === 'EXPIRED' && aAfter.payment === 'EXPIRED',
    JSON.stringify(aAfter),
  );
  check(
    'its PayOS link was cancelled first',
    aAfter.intent === 'CANCELLED' &&
      (await fakeLink(a.orderCode)).status === 'CANCELLED',
    aAfter.intent,
  );
  const bAfter = state(b.purchaseId);
  check(
    'a purchase paid at PayOS without a webhook is confirmed by the sweep',
    bAfter.purchase === 'COMPLETED' &&
      bAfter.intent === 'PAID' &&
      activeSubscriptions(b.purchaseId) === 1,
    JSON.stringify(bAfter),
  );
  check(
    'a purchase still inside its window is untouched',
    state(d.purchaseId).purchase === 'PENDING_PAYMENT' &&
      (await fakeLink(d.orderCode)).status === 'PENDING',
    JSON.stringify(state(d.purchaseId)),
  );
  const again = await call('POST', '/plan-purchases', unpaid.token, {
    planVersionId: plusVersion,
    idempotencyKey: randomUUID(),
  });
  check(
    'the learner whose purchase expired can buy again',
    again.status === 201,
    `HTTP ${again.status}`,
  );

  console.log(`\nSTALE_PURCHASE_SWEEP_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
