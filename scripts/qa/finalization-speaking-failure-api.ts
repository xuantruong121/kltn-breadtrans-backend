/**
 * Speaking practice provider failure and recovery, on the disposable harness.
 *
 *   phase=fail    : backend started with MOCK_AZURE_SIMULATE_5XX=true. A submit
 *                   must stay PENDING with a scheduled retry, no score, no XP.
 *   phase=recover : backend restarted normally. The same submission must be
 *                   retried by the poller, complete, and be rewarded once.
 *
 * Usage: npx ts-node scripts/qa/finalization-speaking-failure-api.ts fail <wav>
 *        npx ts-node scripts/qa/finalization-speaking-failure-api.ts recover
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, readFileSync as read } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BE, check, failureCount, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const STATE = join(tmpdir(), 'breadtrans-speaking-failure.json');
const row = (id: number) =>
  harnessQuery(
    `select status, "overallScore", "lastErrorCode", "nextAttemptAt" is not null, "attemptCount", "rewardStatus", "feedbackStatus" from "SpeakingSubmission" where id = ${id}`,
  )[0];
const xp = (userId: number) =>
  harnessQuery(
    `select count(*), coalesce(sum(points), 0) from "PointHistory" where "userId" = ${userId} and reason like 'Hoàn thành bài luyện nói%'`,
  )[0].join('/');

async function fail(wavPath: string) {
  const s = await newStudent('spk-fail');
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(readFileSync(wavPath))], { type: 'audio/wav' }),
    'a.wav',
  );
  const res = await fetch(`${BE}/speaking/exercises/1/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${s.token}`,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  const id = (await res.json()).data.submissionId as number;
  await new Promise((ok) => setTimeout(ok, 6000));
  const r = row(id);
  check(
    'provider 503: submission stays PENDING with a scheduled retry, no score',
    r[0] === 'PENDING' && r[1] === '' && r[3] === 't' && r[4] === '1',
    JSON.stringify(r),
  );
  check('provider 503: no XP granted', xp(s.userId) === '0/0', xp(s.userId));
  writeFileSync(STATE, JSON.stringify({ id, userId: s.userId }));
}

async function recover() {
  const { id, userId } = JSON.parse(read(STATE, 'utf8'));
  // Bring the scheduled retry forward instead of waiting the 60 s backoff.
  harnessExec(
    `update "SpeakingSubmission" set "nextAttemptAt" = now() where id = ${id} and status = 'PENDING'`,
  );
  let r = row(id);
  for (
    let i = 0;
    i < 30 &&
    (r[0] !== 'COMPLETED' || r[5] !== 'COMPLETED' || r[6] !== 'COMPLETED');
    i += 1
  ) {
    await new Promise((ok) => setTimeout(ok, 1500));
    r = row(id);
  }
  check(
    'after restart the retry completes the submission, reward and feedback',
    r[0] === 'COMPLETED' &&
      r[5] === 'COMPLETED' &&
      r[6] === 'COMPLETED' &&
      r[2] === '',
    JSON.stringify(r),
  );
  const expected = Math.max(10, Math.round(Number(r[1]) * 5));
  check(
    'XP granted exactly once after recovery',
    xp(userId) === `1/${expected}`,
    xp(userId),
  );
}

void (async () => {
  if (process.argv[2] === 'fail') await fail(process.argv[3]);
  else await recover();
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
})();
