/**
 * Free PLUS trial (B8) and referral (B7) on the disposable harness (fake
 * PayOS, mock graders; nothing reaches payOS).
 *
 * Trial: finishing the entry diagnostic gives a learner one 3-day PLUS trial
 * (once), shown in the expiry summary with 5 Speaking / 3 Writing gradings;
 * a used-up allowance refuses a paid-level Writing or Speaking grading with
 * TRIAL_GRADING_LIMIT but not a Basic-level one; paying for PLUS during the
 * trial starts the paid plan now and ends the trial.
 *
 * Referral: a learner's code is entered by a new learner; own code, a second
 * code and an unknown code are refused; the invitee's first payment gives
 * both 7 days (the paying invitee's plan extended, the free referrer 7 days
 * of PLUS); a second payment gives nothing more.
 *
 * Start the backend with: QA_PAYOS=fake finalization-harness.sh qa-backend <db>
 * Usage: HARNESS_DB=<db> QA_DB_NAME=<db> QA_WAV=<wav> npx ts-node --transpile-only scripts/qa/trial-referral-api.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  BE,
  call,
  check,
  failureCount,
  newStudent,
  unlockAllLevels,
} from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';
import { runCase } from './cp60diag-observed-api';

const FAKE = 'http://127.0.0.1:9470';
const DAY = 86400;
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
const redis = (...args: string[]) =>
  execFileSync('docker', ['exec', 'harness-redis', 'redis-cli', ...args], {
    encoding: 'utf8',
  }).trim();

const plusVersion = () =>
  Number(
    one(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and pv.status = 'PUBLISHED' and pv."durationDays" = 30 and p.code = 'PLUS'`,
    ),
  );

async function buyAndPay(token: string) {
  const r = await call('POST', '/plan-purchases', token, {
    planVersionId: plusVersion(),
    idempotencyKey: randomUUID(),
  });
  const intentId = r.data?.payos?.intentId;
  const orderCode = one(
    `select "orderCode" from "PayOSPaymentIntent" where id = ${Number(intentId)}`,
  );
  await fetch(`${FAKE}/__mock/pay/${orderCode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  await call('POST', `/payments/payos/${intentId}/sync`, token, {});
  return r;
}

const subs = (userId: number) =>
  harnessQuery(
    `select s.id, s.source, p.code, round(extract(epoch from (s."endsAt" - s."startsAt"))), extract(epoch from (s."endsAt" - now())) > 0, extract(epoch from (now() - s."startsAt")) from "Subscription" s join "PlanVersion" pv on pv.id = s."planVersionId" join "Plan" p on p.id = pv."planId" where s."userId" = ${userId} and p.code <> 'FREE' order by s.id`,
  );

async function main() {
  // ---------- Trial ----------
  const t = await newStudent('trial');
  await runCase(
    'trial',
    { listening: 6, reading: 6, speaking: [], writing: [] },
    t,
  );
  // The result endpoint refreshes the result again; the trial must stay one.
  await call('GET', '/diagnostic/results/latest', t.token);
  const tSubs = subs(t.userId);
  check(
    'the diagnostic gives one PLUS trial of 3 days',
    tSubs.length === 1 &&
      tSubs[0][1] === 'TRIAL' &&
      tSubs[0][2] === 'PLUS' &&
      Number(tSubs[0][3]) === 3 * DAY,
    JSON.stringify(tSubs),
  );
  const trialId = Number(tSubs[0]?.[0]);
  check(
    'a trial notification is sent',
    one(
      `select count(*) from "Notification" where "userId" = ${t.userId} and type = 'trial:${trialId}'`,
    ) === '1',
  );
  const me = (await call('GET', '/subscriptions/me', t.token)).data;
  check(
    'the learner is on PLUS during the trial',
    (me?.plan?.code ?? me?.planCode) === 'PLUS',
    JSON.stringify(me).slice(0, 100),
  );
  const summary = (
    await call('GET', '/subscriptions/me/expiry-summary', t.token)
  ).data;
  check(
    'the summary shows 5 Speaking and 3 Writing gradings left',
    summary?.trial?.speakingLeft === 5 && summary?.trial?.writingLeft === 3,
    JSON.stringify(summary?.trial),
  );

  unlockAllLevels(t.userId);
  redis('HSET', `trial:gradings:${trialId}`, 'WRITING', '3', 'SPEAKING', '5');
  const after = (await call('GET', '/subscriptions/me/expiry-summary', t.token))
    .data;
  check(
    'used gradings show as 0 left',
    after?.trial?.speakingLeft === 0 && after?.trial?.writingLeft === 0,
    JSON.stringify(after?.trial),
  );
  const w = await call('POST', '/writing/quizzes/18/submit', t.token, {
    answer: 'Dear Ms. Lan, I would like to move our meeting to Monday morning.',
    clientAttemptId: randomUUID(),
  });
  check(
    'a paid-level Writing grading is refused when the trial allowance is used',
    w.status === 403 && /3\/3 lượt chấm Viết/.test(String(w.message)),
    `(${w.status} ${w.message})`,
  );
  const basic = await call('POST', '/writing/quizzes/17/submit', t.token, {
    answer: 'Hi Tom, see you at the station at six. Thanks, An.',
    clientAttemptId: randomUUID(),
  });
  check(
    'a Basic-level Writing grading is not counted against the trial',
    !/lượt chấm/.test(String(basic.message ?? '')),
    `(${basic.status} ${String(basic.message ?? '').slice(0, 80)})`,
  );
  const spkId = Number(
    one(
      `select id from "SpeakingExercise" where "practiceSetId" = 'practice-pronunciation-b1' order by "order" limit 1`,
    ),
  );
  const form = new FormData();
  form.append(
    'audio',
    new Blob([Buffer.alloc(10)], { type: 'audio/wav' }),
    'a.wav',
  );
  const s = await fetch(`${BE}/speaking/exercises/${spkId}/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${t.token}`,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  const sBody = await s.json().catch(() => ({}));
  check(
    'a paid-level Speaking grading is refused when the trial allowance is used',
    s.status === 403 && /5\/5 lượt chấm Nói/.test(JSON.stringify(sBody)),
    `(${s.status})`,
  );

  await buyAndPay(t.token);
  const paid = subs(t.userId);
  const trialRow = paid.find((r) => r[1] === 'TRIAL');
  const plusRow = paid.find((r) => r[1] === 'PURCHASE');
  check(
    'paying during the trial ends the trial',
    trialRow?.[4] === 'f',
    JSON.stringify(trialRow),
  );
  check(
    'the paid PLUS starts now, not after the trial',
    !!plusRow && Number(plusRow[5]) < 120 && Number(plusRow[3]) === 30 * DAY,
    JSON.stringify(plusRow),
  );
  const w2 = await call('POST', '/writing/quizzes/18/submit', t.token, {
    answer: 'Dear Ms. Lan, I would like to move our meeting to Monday morning.',
    clientAttemptId: randomUUID(),
  });
  check(
    'after paying, the trial allowance no longer applies',
    !/lượt chấm/.test(String(w2.message ?? '')),
    `(${w2.status})`,
  );
  const t2 = await newStudent('trial-paid-before');
  await buyAndPay(t2.token);
  await runCase(
    'trial2',
    { listening: 6, reading: 6, speaking: [], writing: [] },
    t2,
  );
  check(
    'an account that already paid gets no trial',
    subs(t2.userId).every((r) => r[1] !== 'TRIAL'),
    JSON.stringify(subs(t2.userId)),
  );

  const t3 = await newStudent('trial-old-result');
  await runCase(
    'trial3',
    { listening: 6, reading: 6, speaking: [], writing: [] },
    t3,
  );
  harnessExec(
    `delete from "SubscriptionEvent" where "subscriptionId" in (select id from "Subscription" where "userId" = ${t3.userId});
     delete from "Subscription" where "userId" = ${t3.userId};
     update "DiagnosticAttempt" set "completedAt" = now() - interval '3 days', "submittedAt" = now() - interval '3 days' where "userId" = ${t3.userId};`,
  );
  await call('GET', '/diagnostic/results/latest', t3.token);
  check(
    'reopening a result finished days ago starts no trial',
    subs(t3.userId).length === 0,
    JSON.stringify(subs(t3.userId)),
  );

  // ---------- Referral ----------
  const r = await newStudent('referrer');
  const mine = (await call('GET', '/referrals/me', r.token)).data;
  check(
    'a learner gets an invite code',
    /^BT-[A-HJ-KM-NP-Z2-9]{6}$/.test(mine?.code ?? '') && mine?.invited === 0,
    JSON.stringify(mine),
  );
  const own = await call('POST', '/referrals/claim', r.token, {
    code: mine.code,
  });
  check(
    'a learner cannot enter their own code',
    own.status === 400 && /chính bạn/.test(String(own.message)),
    `(${own.status})`,
  );
  const inv = await newStudent('invitee');
  const bad = await call('POST', '/referrals/claim', inv.token, {
    code: 'BT-ZZZZZZ',
  });
  check(
    'an unknown code is refused',
    bad.status === 400 && /không tồn tại/.test(String(bad.message)),
    `(${bad.status})`,
  );
  const ok = await call('POST', '/referrals/claim', inv.token, {
    code: mine.code.toLowerCase(),
  });
  check(
    'a new learner enters a friend’s code',
    ok.status === 200 &&
      ok.data?.invitedBy?.status === 'PENDING' &&
      ok.data?.canClaim === false,
    JSON.stringify(ok.data),
  );
  const other = (
    await call('GET', '/referrals/me', (await newStudent('other-ref')).token)
  ).data;
  const twice = await call('POST', '/referrals/claim', inv.token, {
    code: other.code,
  });
  check(
    'a second code is refused',
    twice.status === 400 && /trước đó/.test(String(twice.message)),
    `(${twice.status})`,
  );

  await buyAndPay(inv.token);
  const invSubs = subs(inv.userId);
  check(
    'the invitee’s paid plan gets 7 more days (37 in all)',
    invSubs.length === 1 && Number(invSubs[0][3]) === 37 * DAY,
    JSON.stringify(invSubs),
  );
  const refSubs = subs(r.userId);
  check(
    'the free referrer gets 7 days of PLUS from now',
    refSubs.length === 1 &&
      refSubs[0][1] === 'REFERRAL' &&
      refSubs[0][2] === 'PLUS' &&
      Number(refSubs[0][3]) === 7 * DAY,
    JSON.stringify(refSubs),
  );
  const status = one(
    `select status from "Referral" where "inviteeId" = ${inv.userId}`,
  );
  check('the referral is marked rewarded', status === 'REWARDED', status);
  check(
    'both get a reward notification',
    one(
      `select count(*) from "Notification" where type like 'referral_reward:%' and "userId" in (${r.userId}, ${inv.userId})`,
    ) === '2',
  );
  const summaryR = (await call('GET', '/referrals/me', r.token)).data;
  check(
    'the referrer sees 1 invited, 1 rewarded',
    summaryR?.invited === 1 && summaryR?.rewarded === 1,
    JSON.stringify(summaryR),
  );
  await buyAndPay(inv.token);
  check(
    'a second payment gives no second reward',
    subs(r.userId).length === 1 &&
      one(
        `select count(*) from "SubscriptionEvent" e join "Subscription" s on s.id = e."subscriptionId" where e.type = 'REFERRAL_REWARD' and s."userId" in (${r.userId}, ${inv.userId})`,
      ) === '2',
  );
  const late = await newStudent('late-invitee');
  harnessExec(
    `update "User" set "createdAt" = now() - interval '9 days' where id = ${late.userId}`,
  );
  const tooLate = await call('POST', '/referrals/claim', late.token, {
    code: mine.code,
  });
  check(
    'a code entered after 7 days is refused',
    tooLate.status === 400 && /7 ngày/.test(String(tooLate.message)),
    `(${tooLate.status})`,
  );

  console.log(`\nTRIAL_REFERRAL_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
