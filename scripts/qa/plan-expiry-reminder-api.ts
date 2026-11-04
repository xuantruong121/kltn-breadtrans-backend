/**
 * Plan expiry reminders on the disposable harness: learners whose paid plan
 * ends in 7, 3, 1 and 0 Vietnam days get one reminder each (in-app
 * notification, push attempted, email suppressed outside production); a plan
 * ending in 5 days gets none; a plan already renewed gets none; running the
 * job again for the same day sends nothing new.
 *
 * The job is queued on the harness Redis exactly as the 09:00 cron queues it;
 * the harness backend's worker runs it.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/plan-expiry-reminder-api.ts
 */
import { Queue } from 'bullmq';

import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const REDIS = { host: '127.0.0.1', port: 6392 };
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Today's Vietnam calendar day, as the cron computes it. */
const dayKey = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

async function grantPlus(admin: string, userId: number) {
  const planVersionId = Number(
    one(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and pv.status = 'PUBLISHED' and p.code = 'PLUS'`,
    ),
  );
  const r = await call('POST', '/admin/subscriptions/grant', admin, {
    studentId: userId,
    planVersionId,
    durationDays: 30,
    reason: 'Harness: plan expiry reminders',
  });
  if (r.status >= 300) throw new Error(`grant ${r.status}`);
}

/** Move the learner's plan so it ends on Vietnam day dayKey + days, 15:00. */
function endIn(userId: number, days: number) {
  // 23:59 Vietnam time, so a plan ending today is still running whenever the
  // suite runs that day (the real job runs at 09:00).
  harnessExec(
    `update "Subscription" set "startsAt" = now() - interval '20 days', "endsAt" = ('${dayKey}'::date + ${days} + time '23:59') at time zone 'Asia/Ho_Chi_Minh' where "userId" = ${userId}`,
  );
}

const reminders = (userId: number) =>
  harnessQuery(
    `select type, title from "Notification" where "userId" = ${userId} and type like 'plan_expiry:%' order by id`,
  );

async function runJob(queue: Queue, suffix: string) {
  const job = await queue.add(
    'plan-expiry-reminder',
    { version: 1, dayKey },
    // A fresh id per run: BullMQ ignores a job whose id already completed.
    { jobId: `plan-expiry-reminder-${dayKey}-qa-${suffix}-${Date.now()}` },
  );
  for (let i = 0; i < 60; i += 1) {
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return state;
    await sleep(1000);
  }
  return 'timeout';
}

async function main() {
  const admin = await newAdmin('expiry-admin');
  const learners: Record<string, { userId: number }> = {};
  for (const days of [7, 3, 1, 0, 5]) {
    const learner = await newStudent(`expiry-d${days}`);
    await grantPlus(admin.token, learner.userId);
    endIn(learner.userId, days);
    learners[`d${days}`] = learner;
  }
  const renewed = await newStudent('expiry-renewed');
  await grantPlus(admin.token, renewed.userId);
  endIn(renewed.userId, 3);
  // A queued renewal starting when the running plan ends.
  harnessExec(
    `insert into "Subscription" ("userId", "planVersionId", status, "startsAt", "endsAt", "updatedAt")
     select "userId", "planVersionId", 'ACTIVE', "endsAt", "endsAt" + interval '30 days', now() from "Subscription" where "userId" = ${renewed.userId}`,
  );

  const queue = new Queue('breadtrans-system-jobs', { connection: REDIS });
  const state = await runJob(queue, 'first');
  check('the reminder job completed', state === 'completed', `(${state})`);

  for (const days of [7, 3, 1, 0]) {
    const rows = reminders(learners[`d${days}`].userId);
    check(
      `plan ending in ${days} day(s): one reminder for milestone d${days}`,
      rows.length === 1 && rows[0][0].endsWith(`:d${days}`),
      JSON.stringify(rows),
    );
  }
  check(
    'D-0 title says it ends today; D-3 says 3 days left',
    reminders(learners.d0.userId)[0]?.[1] === 'Gói Plus hết hạn hôm nay' &&
      reminders(learners.d3.userId)[0]?.[1] === 'Gói Plus còn 3 ngày',
    JSON.stringify([
      reminders(learners.d0.userId),
      reminders(learners.d3.userId),
    ]),
  );
  check(
    'a plan ending in 5 days gets no reminder',
    reminders(learners.d5.userId).length === 0,
  );
  check(
    'a plan already renewed gets no reminder',
    reminders(renewed.userId).length === 0,
  );

  const again = await runJob(queue, 'again');
  const total = Object.values(learners).reduce(
    (n, learner) => n + reminders(learner.userId).length,
    0,
  );
  check(
    'running the job again the same day sends nothing new',
    again === 'completed' && total === 4,
    `(${again}, ${total} reminders)`,
  );
  await queue.close();

  console.log(`\nPLAN_EXPIRY_REMINDER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
