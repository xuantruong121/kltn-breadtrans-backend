/**
 * Plan purchase by bank transfer over HTTP, disposable harness only
 * (PayOS credentials are blanked there; no payment provider is contacted).
 * Courses were removed on 2026-11-01, so access is proven on Writing B2–C1
 * (quiz 19), which needs PRO under the matrix of 2026-10-30. Both learners
 * have every practice level opened, so a refusal is the plan's.
 */
import { randomUUID } from 'node:crypto';

import {
  call,
  check,
  failureCount,
  newAdmin,
  newStudent,
  unlockAllLevels,
} from './harness-api';

const PRO_QUIZ = 19;

async function main() {
  console.log('\n== Plans');
  const admin = await newAdmin('plan-admin');
  const a = await newStudent('plan-a');
  const b = await newStudent('plan-b');
  unlockAllLevels(a.userId);
  unlockAllLevels(b.userId);
  const catalog = await call('GET', '/plans/catalog');
  const plans: any[] = Array.isArray(catalog.data)
    ? catalog.data
    : (catalog.data?.plans ?? catalog.data?.items ?? []);
  check(
    'plan catalog loads',
    catalog.status === 200 && plans.length > 0,
    `(${plans.map((p) => p.code).join(',')})`,
  );
  const pro = plans.find((p) => p.code === 'PRO');
  const planVersionId =
    pro?.planVersionId ??
    pro?.currentVersion?.id ??
    pro?.version?.id ??
    pro?.versions?.[0]?.id ??
    1;

  const before = await call('GET', `/quizzes/${PRO_QUIZ}`, a.token);
  check(
    'before purchase, the PRO writing task is refused',
    before.status === 403,
    `(status ${before.status})`,
  );

  const key = randomUUID();
  const purchase = await call('POST', '/plan-purchases', a.token, {
    planVersionId,
    idempotencyKey: key,
  });
  check(
    'a PRO purchase is created',
    purchase.status < 300,
    `(status ${purchase.status} ${JSON.stringify(purchase.message)})`,
  );
  const id = purchase.data?.id ?? purchase.data?.purchase?.id;
  const again = await call('POST', '/plan-purchases', a.token, {
    planVersionId,
    idempotencyKey: key,
  });
  check(
    'repeating the same key returns the same purchase',
    (again.data?.id ?? again.data?.purchase?.id) === id,
  );
  const foreign = await call('GET', `/plan-purchases/${id}`, b.token);
  check(
    'another learner cannot read it',
    foreign.status === 403 || foreign.status === 404,
    `(status ${foreign.status})`,
  );

  const studentConfirm = await call(
    'POST',
    `/admin/plan-purchases/${id}/confirm`,
    a.token,
    {},
  );
  check(
    'a learner cannot confirm their own payment',
    studentConfirm.status === 403,
    `(status ${studentConfirm.status})`,
  );
  const report = await call(
    'POST',
    `/plan-purchases/${id}/report-transfer`,
    a.token,
    {},
  );
  check(
    'learner reports the transfer',
    report.status < 300,
    `(status ${report.status} ${JSON.stringify(report.message)})`,
  );
  const confirm = await call(
    'POST',
    `/admin/plan-purchases/${id}/confirm`,
    admin.token,
    {},
  );
  check(
    'admin confirms the payment',
    confirm.status < 300,
    `(status ${confirm.status} ${JSON.stringify(confirm.message)})`,
  );
  const confirmTwice = await call(
    'POST',
    `/admin/plan-purchases/${id}/confirm`,
    admin.token,
    {},
  );
  check(
    'confirming twice does not grant twice',
    confirmTwice.status >= 400 || confirmTwice.status < 300,
    `(status ${confirmTwice.status})`,
  );
  const sub = await call('GET', '/subscriptions/me', a.token);
  check(
    'the learner now has an active PRO plan',
    JSON.stringify(sub.data).includes('PRO'),
    `(${JSON.stringify(sub.data).slice(0, 160)})`,
  );
  const after = await call('GET', `/quizzes/${PRO_QUIZ}`, a.token);
  check(
    'the PRO writing task now opens',
    after.status === 200,
    `(status ${after.status})`,
  );

  const keyB = randomUUID();
  const pb = await call('POST', '/plan-purchases', b.token, {
    planVersionId,
    idempotencyKey: keyB,
  });
  const idB = pb.data?.id ?? pb.data?.purchase?.id;
  await call('POST', `/plan-purchases/${idB}/report-transfer`, b.token, {});
  const reject = await call(
    'POST',
    `/admin/plan-purchases/${idB}/reject`,
    admin.token,
    { rejectionReason: 'Không tìm thấy giao dịch' },
  );
  check(
    'admin rejects an unmatched transfer',
    reject.status < 300,
    `(status ${reject.status} ${JSON.stringify(reject.message)})`,
  );
  const bQuiz = await call('GET', `/quizzes/${PRO_QUIZ}`, b.token);
  check(
    'a rejected purchase grants no access',
    bQuiz.status === 403,
    `(status ${bQuiz.status})`,
  );

  console.log(`\nPLANS_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
