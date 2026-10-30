/**
 * Which part of the feedback-enrichment result a learner sees (deterministic:
 * `fakeazure` mode, Azure answered from the scenario file, Gemini wording fixed
 * by LIVE_GEMINI_FAKE_JSON; no network).
 *
 *   HARNESS_DB=diag_clone AUDIO_DIR=<dir> FAKE_FILE=<json> SHOTS=<dir> \
 *     npx ts-node --transpile-only scripts/qa/cp60-feedback-ui-browser.ts
 */
import { writeFileSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const AUDIO = process.env.AUDIO_DIR!;
const SHOTS = process.env.SHOTS ?? '.';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const PARAGRAPH = 'Đoạn nhận xét cố định QA: bạn đọc rõ ràng và tự nhiên.';
const SUGGESTION = 'Gợi ý cố định QA: giữ nhịp đọc đều.';

async function main() {
  const target =
    'The library opens at eight o’clock and closes at six in the evening.';
  writeFileSync(
    process.env.FAKE_FILE!,
    JSON.stringify({
      __scenario: 'valid',
      RecognitionStatus: 'Success',
      NBest: [
        {
          Display: target,
          PronunciationAssessment: {
            AccuracyScore: 94,
            FluencyScore: 100,
            CompletenessScore: 100,
            PronScore: 96.4,
          },
          Words: target
            .replace('.', '')
            .split(' ')
            .map((Word, i) => ({
              Word: Word.toLowerCase(),
              Offset: i * 3_000_000,
              Duration: 2_500_000,
              PronunciationAssessment: { AccuracyScore: 94, ErrorType: 'None' },
            })),
        },
      ],
    }),
  );
  const s = await studentPage('feedback-ui', 1366, false, [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${AUDIO}/a-full.wav`,
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
    let fs = '';
    for (let i = 0; i < 90; i += 1) {
      fs = harnessQuery(
        `select "feedbackStatus" from "SpeakingSubmission" where "userId" = ${s.account.userId} order by id desc limit 1`,
      )[0]?.[0];
      if (fs === 'COMPLETED' || fs === 'FAILED') break;
      await sleep(1000);
    }
    await sleep(4000);
    const text = (await s.page.locator('body').innerText()).replace(
      /\s+/g,
      ' ',
    );
    await s.page.screenshot({
      path: `${SHOTS}/feedback-ui.png`,
      fullPage: true,
    });
    console.log(`feedbackStatus ${fs}`);
    check(
      'Gemini suggestions reach the learner after feedback completes',
      text.includes(SUGGESTION),
    );
    console.log(
      `INFO Gemini feedback paragraph shown on the result: ${text.includes(PARAGRAPH)}`,
    );
  } finally {
    await s.browser.close();
  }
  console.log(`\nCP60_FEEDBACK_UI_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(2);
});
