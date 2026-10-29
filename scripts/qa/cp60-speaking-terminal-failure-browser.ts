/**
 * Azure keeps returning a response without PronScore (deterministic
 * `fakeazure` mode, no network): the submission must end FAILED after the 4
 * bounded attempts (in-process worker backoff 1, 5, 15 min: about 21 min),
 * with no score, no reward and the learner audio kept.
 *
 * Long-running (up to 25 min), so it runs only when asked for explicitly:
 *
 *   CP60_LONG_E2E=1 HARNESS_DB=diag_clone AUDIO_DIR=<dir> FAKE_FILE=<json> \
 *     npx ts-node --transpile-only scripts/qa/cp60-speaking-terminal-failure-browser.ts
 */
import { writeFileSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function main() {
  if (process.env.CP60_LONG_E2E !== '1') {
    console.log(
      'NOT_RUN: long-running terminal-failure e2e (set CP60_LONG_E2E=1 to run it)',
    );
    process.exit(0);
  }
  writeFileSync(
    process.env.FAKE_FILE!,
    JSON.stringify({
      __scenario: 'missing-pronscore-forever',
      RecognitionStatus: 'Success',
      NBest: [
        {
          Display: 'The library opens at eight.',
          PronunciationAssessment: {
            AccuracyScore: 94,
            FluencyScore: 100,
            CompletenessScore: 100,
          },
          Words: [
            {
              Word: 'the',
              Offset: 0,
              Duration: 2_000_000,
              PronunciationAssessment: { AccuracyScore: 94, ErrorType: 'None' },
            },
          ],
        },
      ],
    }),
  );
  const s = await studentPage('terminal-failure', 1366, false, [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${process.env.AUDIO_DIR}/a-full.wav`,
  ]);
  try {
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
    let r: string[] | undefined;
    const started = Date.now();
    for (let i = 0; i < 1500; i += 1) {
      [r] = harnessQuery(
        `select id, status, "overallScore", "rewardStatus", coalesce("lastErrorCode",''), coalesce("audioKey",''), "attemptCount"
           from "SpeakingSubmission" where "userId" = ${s.account.userId} order by id desc limit 1`,
      );
      if (r?.[1] === 'FAILED') break;
      await sleep(1000);
    }
    await sleep(3000);
    const text = (await s.page.locator('body').innerText()).replace(
      /\s+/g,
      ' ',
    );
    console.log(
      `after ${Math.round((Date.now() - started) / 1000)} s: ${JSON.stringify(r)}`,
    );
    check(
      'repeated invalid Azure output ends FAILED after 4 attempts, never a grade',
      r?.[1] === 'FAILED' &&
        r[2] === '' &&
        r[4] === 'PROVIDER_UNAVAILABLE' &&
        r[6] === '4',
      JSON.stringify(r),
    );
    check(
      'no reward and the learner audio is kept',
      r?.[3] !== 'COMPLETED' &&
        !!r?.[5] &&
        harnessQuery(
          `select count(*) from "SpeakingRewardLedger" where "submissionId" = ${r?.[0]}`,
        )[0][0] === '0',
    );
    check(
      'the learner sees no score and a not-graded / delayed message',
      /chưa thành công|không thành công|thử lại|kéo dài hơn dự kiến/i.test(
        text,
      ) && !text.includes('ĐIỂM / 10'),
    );
  } finally {
    await s.browser.close();
  }
  console.log(`\nCP60_SPEAKING_TERMINAL_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(2);
});
