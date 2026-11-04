/**
 * The Monday weekly report on the disposable harness: a learner who
 * practised last week gets one report with last week's count, the score
 * movement, a skill to put first and the days to their exam date; a learner
 * active three weeks ago gets a nudge; a learner with no practice gets
 * nothing; a rerun for the same week sends nothing new.
 *
 * The job is queued on the harness Redis exactly as the Monday 08:00 cron
 * queues it; the harness backend's worker runs it.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/weekly-report-api.ts
 */
import { Queue } from 'bullmq';

import { check, failureCount, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const REDIS = { host: '127.0.0.1', port: 6392 };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Today's Vietnam calendar day, as the cron computes it. */
const dayKey = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
/** This Monday 00:00 in Vietnam, as SQL. */
const MONDAY = `(date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh')`;

function addEvent(
  userId: number,
  skill: string,
  score: number,
  offset: string,
  n: number,
) {
  harnessExec(
    `insert into "LearnerProgressEvent" ("userId", skill, level, "contentType", "contentId", "sourceKey", "scorePercent", "createdAt")
     values (${userId}, '${skill}', 'STARTER', 'QUIZ', ${900000 + n}, 'qa-weekly:${userId}:${n}', ${score}, ${MONDAY} + interval '${offset}')`,
  );
}

const reports = (userId: number) =>
  harnessQuery(
    `select type, title, body from "Notification" where "userId" = ${userId} and type like 'weekly_report:%' order by id`,
  );

async function runJob(queue: Queue, suffix: string) {
  const job = await queue.add(
    'weekly-report',
    { version: 1, dayKey },
    // A fresh id per run: BullMQ ignores a job whose id already completed.
    { jobId: `weekly-report-${dayKey}-qa-${suffix}-${Date.now()}` },
  );
  for (let i = 0; i < 90; i += 1) {
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return state;
    await sleep(1000);
  }
  return 'timeout';
}

async function main() {
  const busy = await newStudent('weekly-busy');
  addEvent(busy.userId, 'READING', 80, '-7 days', 1);
  addEvent(busy.userId, 'READING', 70, '-1 day', 2);
  addEvent(busy.userId, 'LISTENING', 75, '-3 days', 3);
  addEvent(busy.userId, 'READING', 60, '-10 days', 4);
  harnessExec(
    `insert into "LearnerProfile" ("userId", goal, "minutesPerDay", "targetDate", "updatedAt")
     values (${busy.userId}, 'TOEIC_SCORE', 15, now() + interval '30 days', now())
     on conflict ("userId") do update set goal = excluded.goal, "minutesPerDay" = 15, "targetDate" = excluded."targetDate"`,
  );
  const lapsed = await newStudent('weekly-lapsed');
  addEvent(lapsed.userId, 'SPEAKING', 65, '-20 days', 5);
  const idle = await newStudent('weekly-idle');

  const queue = new Queue('breadtrans-system-jobs', { connection: REDIS });
  const state = await runJob(queue, 'first');
  check('the weekly report job completed', state === 'completed', `(${state})`);

  const mine = reports(busy.userId);
  const body = mine[0]?.[2] ?? '';
  check(
    'a learner who practised gets one report',
    mine.length === 1,
    JSON.stringify(mine),
  );
  check(
    'its title counts last week',
    mine[0]?.[1] === 'Tuần qua bạn luyện 3 bài',
    mine[0]?.[1],
  );
  check('it lists the skills', body.includes('(Nghe 1, Đọc 2)'), body);
  check(
    'it reports the reading average and its rise',
    body.includes(
      'Đọc: điểm luyện tập trung bình 75%, tăng 15 điểm so với tuần trước.',
    ),
    body,
  );
  check(
    'it names a skill to put first',
    /Tuần này nên ưu tiên (Nói|Viết|Nghe|Đọc): mục tiêu \d+ bài\./.test(body),
    body,
  );
  check(
    'it counts the days to the exam',
    body.includes('Còn 30 ngày tới ngày thi bạn đặt.'),
    body,
  );
  check(
    'it says the score is an internal practice indicator',
    body.includes('không phải điểm thi chính thức'),
    body,
  );

  const nudge = reports(lapsed.userId);
  check(
    'a learner active three weeks ago gets a nudge',
    nudge.length === 1 && nudge[0][1] === 'Tuần mới, bắt đầu lại nhé',
    JSON.stringify(nudge),
  );
  check(
    'a learner with no practice gets nothing',
    reports(idle.userId).length === 0,
  );

  const again = await runJob(queue, 'again');
  check(
    'running the job again the same week sends nothing new',
    again === 'completed' &&
      reports(busy.userId).length === 1 &&
      reports(lapsed.userId).length === 1,
    `(${again})`,
  );
  await queue.close();

  console.log(`\nWEEKLY_REPORT_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
