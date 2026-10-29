/**
 * Missing Azure metrics through the real Speaking Practice pipeline
 * (deterministic: the harness backend runs speaking-live-azure-server.ts with
 * LIVE_AZURE_FAKE_FILE, so Azure responses come from a local scenario file and
 * nothing leaves the machine).
 *
 *  1. PronScore missing -> no grade, retryable failure, audio kept, no reward;
 *     then a valid response -> the retry completes once, one XP row.
 *  2. Every score genuinely 0 -> a completed grade of 0 (no reward by policy).
 *
 *   HARNESS_DB=diag_clone AUDIO_DIR=<dir> FAKE_FILE=<json> SHOTS=<dir> \
 *     npx ts-node --transpile-only scripts/qa/cp60-speaking-metric-safety-browser.ts
 */
import { writeFileSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const AUDIO = process.env.AUDIO_DIR!;
const FAKE = process.env.FAKE_FILE!;
const SHOTS = process.env.SHOTS ?? '.';
const TARGET =
  'The library opens at eight o’clock and closes at six in the evening.';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const q = (sql: string) => harnessQuery(sql);

function scenario(name: string, scores: Record<string, unknown>) {
  const words = TARGET.replace(/[.]/g, '')
    .split(' ')
    .map((Word, i) => ({
      Word: Word.toLowerCase(),
      Offset: 10_000_000 + i * 3_000_000,
      Duration: 2_500_000,
      PronunciationAssessment: {
        AccuracyScore: Number(scores.AccuracyScore ?? 90) || 0,
        ErrorType: 'None',
      },
    }));
  writeFileSync(
    FAKE,
    JSON.stringify({
      __scenario: name,
      RecognitionStatus: 'Success',
      Duration: 45_000_000,
      NBest: [
        { Display: TARGET, PronunciationAssessment: scores, Words: words },
      ],
    }),
  );
}

const row = (userId: number) =>
  q(
    `select id, status, "overallScore", "rewardStatus", "lastErrorCode", coalesce("audioKey",''), "attemptCount", "nextAttemptAt" is not null, provider
       from "SpeakingSubmission" where "userId" = ${userId} order by id desc limit 1`,
  )[0];
const xpRows = (submissionId: string) =>
  q(
    `select count(*) from "SpeakingRewardLedger" where "submissionId" = ${submissionId}`,
  )[0][0];

async function record(label: string) {
  const s = await studentPage(`spk-metric-${label}`, 1366, false, [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${AUDIO}/a-full.wav`,
  ]);
  await s.page.goto(`${FE}/speaking/1`);
  await hidePet(s.page);
  await s.page
    .getByRole('button', { name: 'Bắt đầu thu âm', exact: true })
    .first()
    .click();
  await sleep(6600);
  await s.page
    .getByRole('button', { name: 'Dừng ghi âm và chấm điểm' })
    .click();
  return s;
}

async function main() {
  console.log('\n== 1. PronScore missing, then a valid retry');
  scenario('missing-pronscore', {
    AccuracyScore: 94,
    FluencyScore: 100,
    CompletenessScore: 100,
  });
  const a = await record('missing');
  let r: string[] | undefined;
  for (let i = 0; i < 60; i += 1) {
    r = row(a.account.userId);
    if (r && r[4] === 'PROVIDER_UNAVAILABLE') break;
    await sleep(1000);
  }
  console.log(`  after invalid response: ${JSON.stringify(r)}`);
  await a.page.screenshot({
    path: `${SHOTS}/metric-missing.png`,
    fullPage: true,
  });
  const audioKey = r?.[5];
  check(
    'invalid Azure output is not a grade: not COMPLETED, no score, retry scheduled',
    !!r &&
      r[1] !== 'COMPLETED' &&
      r[2] === '' &&
      r[4] === 'PROVIDER_UNAVAILABLE',
    JSON.stringify(r),
  );
  check(
    'no reward for the invalid output; the learner audio is kept',
    !!r && xpRows(r[0]) === '0' && r[3] !== 'COMPLETED' && !!audioKey,
  );

  scenario('valid', {
    AccuracyScore: 94,
    FluencyScore: 100,
    CompletenessScore: 100,
    PronScore: 96.4,
  });
  for (let i = 0; i < 180; i += 1) {
    r = row(a.account.userId);
    if (r?.[1] === 'COMPLETED' && r[3] !== 'PENDING' && r[3] !== 'PROCESSING')
      break;
    await sleep(1000);
  }
  await sleep(2000);
  r = row(a.account.userId);
  console.log(`  after valid retry: ${JSON.stringify(r)}`);
  check(
    'the retry completes the same submission with the valid score',
    r?.[1] === 'COMPLETED' &&
      Number(r[2]) === 9.6 &&
      Number(r[6]) >= 2 &&
      r[5] === audioKey,
    JSON.stringify(r),
  );
  check(
    'one submission, one XP row after the retry',
    q(
      `select count(*) from "SpeakingSubmission" where "userId" = ${a.account.userId}`,
    )[0][0] === '1' &&
      q(
        `select count(*) from "SpeakingRewardLedger" where "submissionId" = ${r?.[0]} and "rewardType" = 'XP'`,
      )[0][0] === '1',
  );
  await a.browser.close();

  console.log('\n== 2. every score genuinely 0');
  scenario('measured-zero', {
    AccuracyScore: 0,
    FluencyScore: 0,
    CompletenessScore: 0,
    PronScore: 0,
  });
  const z = await record('zero');
  let zr: string[] | undefined;
  for (let i = 0; i < 60; i += 1) {
    zr = row(z.account.userId);
    if (zr?.[1] === 'COMPLETED') break;
    await sleep(1000);
  }
  await sleep(2000);
  zr = row(z.account.userId);
  console.log(`  measured zero: ${JSON.stringify(zr)}`);
  await z.page.screenshot({ path: `${SHOTS}/metric-zero.png`, fullPage: true });
  check(
    'a measured 0 is a completed grade of 0 (not an error), no reward by policy',
    zr?.[1] === 'COMPLETED' &&
      Number(zr[2]) === 0 &&
      zr[4] === '' &&
      xpRows(zr[0]) === '0',
    JSON.stringify(zr),
  );
  await z.browser.close();

  console.log(`\nCP60_SPEAKING_METRIC_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(2);
});
