/**
 * Speaking practice workflow over HTTP, on the disposable harness only
 * (mock assessment: MOCK_AZURE_SPEECH=true, no Azure call).
 *
 * Checks that a read-aloud task keeps the scripted result (per-word list,
 * completeness) while a free answer is assessed without the prompt as
 * reference text; premium media and submissions stay private; XP is granted
 * once per submission.
 *
 * Usage: npx ts-node scripts/qa/finalization-speaking-practice-api.ts <16 kHz mono WAV>
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  BE,
  call,
  check,
  failureCount,
  newProStudent,
  newStudent,
} from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const READ_ALOUD = 1; // free, READ_ALOUD
const FREE_ANSWER = 16; // free, RESPOND_TO_QUESTION
const PREMIUM = 6; // premium, READ_ALOUD
const PREMIUM_KEY = `premium/speaking/reference/${PREMIUM}.v1.mp3`;

async function submit(
  token: string,
  exerciseId: number,
  wav: Buffer,
  key = randomUUID(),
) {
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
    'a.wav',
  );
  const res = await fetch(`${BE}/speaking/exercises/${exerciseId}/submit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    body: form,
  });
  const json: any = await res.json().catch(() => null);
  return { status: res.status, data: json?.data ?? json, key };
}

async function settle(token: string, id: number) {
  for (let i = 0; i < 40; i += 1) {
    const r = await call('GET', `/speaking/submissions/${id}`, token);
    const status = r.data?.status;
    if (status === 'COMPLETED' || status === 'FAILED') return r.data;
    await new Promise((ok) => setTimeout(ok, 750));
  }
  return null;
}

async function main() {
  const wav = readFileSync(process.argv[2]);
  harnessExec(
    `update "SpeakingExercise" set "audioUrl" = '${PREMIUM_KEY}' where id = ${PREMIUM}`,
  );

  const free = await newStudent('spk-free');
  const pro = await newProStudent('spk-pro');

  // Premium media
  const locked = await call(
    'GET',
    `/speaking/exercises/${PREMIUM}`,
    free.token,
  );
  check(
    'free learner sees premium exercise locked, without text or audio',
    locked.status === 403 ||
      (locked.data?.isLocked === true &&
        locked.data?.audioUrl === undefined &&
        locked.data?.targetText === undefined),
    `${locked.status} ${JSON.stringify(Object.keys(locked.data ?? {}))}`,
  );
  const lockedSubmit = await submit(free.token, PREMIUM, wav);
  check(
    'free learner cannot submit to premium exercise',
    lockedSubmit.status === 403,
    String(lockedSubmit.status),
  );
  const open = await call('GET', `/speaking/exercises/${PREMIUM}`, pro.token);
  const url = String(open.data?.audioUrl ?? '');
  check(
    'pro learner gets a short-lived presigned private URL, not the raw key',
    url.startsWith('http://127.0.0.1:9460/harness-private/') &&
      /X-Amz-Signature=/.test(url) &&
      /X-Amz-Expires=300/.test(url),
    url.slice(0, 80),
  );

  // Read-aloud: scripted
  const s1 = await submit(free.token, READ_ALOUD, wav);
  check('read-aloud submit accepted', s1.status === 202, String(s1.status));
  const r1 = await settle(free.token, s1.data.submissionId);
  const f1 = r1?.aiFeedback ?? {};
  check('read-aloud completes', r1?.status === 'COMPLETED', r1?.status);
  check(
    'read-aloud keeps per-word list and completeness',
    Array.isArray(f1.words) &&
      f1.words.length > 0 &&
      Number.isFinite(f1.completenessScore),
  );

  // Free answer: unscripted
  const s2 = await submit(free.token, FREE_ANSWER, wav);
  const r2 = await settle(free.token, s2.data.submissionId);
  const f2 = r2?.aiFeedback ?? {};
  const [prompt] = harnessQuery(
    `select "targetText" from "SpeakingExercise" where id = ${FREE_ANSWER}`,
  )[0];
  check('free answer completes', r2?.status === 'COMPLETED', r2?.status);
  check(
    'free answer has no per-word comparison and no completeness',
    !f2.words &&
      f2.completenessScore === undefined &&
      Array.isArray(f2.problematicWords) &&
      f2.problematicWords.length === 0,
  );
  check(
    'free answer transcript is the learner speech, not the prompt',
    typeof r2?.transcript === 'string' &&
      r2.transcript !== prompt &&
      r2.transcript.startsWith('[mock]'),
    r2?.transcript,
  );
  check(
    'free answer feedback says it is not compared with the question',
    /không so với câu hỏi/.test(f2.feedback ?? ''),
  );
  check(
    'free answer score is on the 0-10 scale',
    r2?.overallScore === 8.1,
    String(r2?.overallScore),
  );

  // Idempotency and ownership
  const again = await submit(free.token, READ_ALOUD, wav, s1.key);
  check(
    'same idempotency key returns the same submission',
    again.data?.submissionId === s1.data.submissionId,
    JSON.stringify(again.data),
  );
  const other = await newStudent('spk-other');
  const peek = await call(
    'GET',
    `/speaking/submissions/${s2.data.submissionId}`,
    other.token,
  );
  check(
    'another learner cannot read the submission',
    peek.status === 403 || peek.status === 404,
    String(peek.status),
  );

  // Rewards and feedback: independent evidence from the clone.
  const ids = [s1.data.submissionId, s2.data.submissionId];
  const statusSql = `select "rewardStatus", "feedbackStatus" from "SpeakingSubmission" where id in (${ids.join(',')}) order by id`;
  const settled = async () => {
    for (let i = 0; i < 20; i += 1) {
      const rows = harnessQuery(statusSql);
      if (rows.every((r) => r[0] === 'COMPLETED' && r[1] === 'COMPLETED'))
        return rows;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    return harnessQuery(statusSql);
  };
  const states = await settled();
  check(
    'reward and feedback reach COMPLETED for both submissions',
    states.every((r) => r[0] === 'COMPLETED' && r[1] === 'COMPLETED'),
    JSON.stringify(states),
  );
  const ledger = () => ({
    xp: harnessQuery(
      `select reason, points from "PointHistory" where "userId" = ${free.userId} order by id`,
    ),
    total: Number(
      harnessQuery(
        `select coalesce(sum("totalPoints"), 0) from "Leaderboard" where "userId" = ${free.userId}`,
      )[0][0],
    ),
    effects: harnessQuery(
      `select "submissionId", "rewardType" from "SpeakingRewardLedger" where "userId" = ${free.userId} order by 1, 2`,
    ),
    banh: harnessQuery(
      `select count(*), coalesce(sum(amount), 0) from "BanhTransaction" where "userId" = ${free.userId} and source = 'SPEAKING_SUBMISSION'`,
    )[0].join('/'),
  });
  const before = ledger();
  const expected = harnessQuery(
    `select "overallScore" from "SpeakingSubmission" where id in (${ids.join(',')}) order by id`,
  ).map((r) => Math.max(10, Math.round(Number(r[0]) * 5)));
  const speakingXp = before.xp.filter((r) =>
    r[0].startsWith('Hoàn thành bài luyện nói'),
  );
  check(
    'XP rows: one per submission, amount = max(10, round(persisted score x 5))',
    speakingXp.length === 2 &&
      speakingXp.map((r) => Number(r[1])).join(',') === expected.join(','),
    `rows=${JSON.stringify(speakingXp)} expected=${expected.join(',')}`,
  );
  check(
    'Leaderboard total equals the sum of PointHistory',
    before.total === before.xp.reduce((n, r) => n + Number(r[1]), 0),
    `total=${before.total}`,
  );
  console.log(
    '      ledger effects',
    JSON.stringify(before.effects),
    'banh count/sum',
    before.banh,
  );

  // Replay: re-open both rewards as if a crash lost the completion write,
  // then refresh the result pages. Nothing may be granted twice.
  harnessExec(
    `update "SpeakingSubmission" set "rewardStatus" = 'PENDING', "rewardGrantedAt" = null, "rewardStartedAt" = null where id in (${ids.join(',')})`,
  );
  await settled();
  for (const id of ids)
    await call('GET', `/speaking/submissions/${id}`, free.token);
  const after = ledger();
  check(
    'replayed reward and refresh grant nothing twice',
    JSON.stringify(after) === JSON.stringify(before),
    `after=${JSON.stringify(after)}`,
  );
  console.log('      SUBMISSIONS', ids.join(','), 'USER', free.userId);

  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

void main();
