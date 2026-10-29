/**
 * CP60-SPEAKING live Azure acceptance (owner-authorized: <= 2 Azure
 * operations, <= 2,000 VND). Harness only; the backend runs
 * speaking-live-azure-server.ts (Azure REST capped, SDK and every other host
 * refused, Gemini feedback rewording stubbed).
 *
 * Full browser path on the real learner route /speaking/1 (READ_ALOUD,
 * scripted assessment): Chromium's fake microphone plays a synthetic Windows
 * TTS clip -> page recorder -> 16 kHz WAV upload -> queue -> processor ->
 * Azure short-audio pronunciation assessment -> persistence -> UI -> refresh.
 *   A: the full reference sentence;   B: only its first half.
 *
 *   HARNESS_DB=diag_clone AUDIO_DIR=<dir> LIVE_AZURE_LOG=<jsonl> SHOTS=<dir> \
 *     npx ts-node --transpile-only scripts/qa/cp60-speaking-live-azure-browser.ts
 */
import { readFileSync } from 'node:fs';

import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const AUDIO = process.env.AUDIO_DIR!;
const LOG = process.env.LIVE_AZURE_LOG!;
const SHOTS = process.env.SHOTS ?? '.';
const EXERCISE = 1;
// DRY=1: rehearsal on the mock backend; provider assertions are skipped.
const DRY = process.env.DRY === '1';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const q = (sql: string) => harnessQuery(sql);

function ledger(userId: number) {
  return q(
    `select
       (select count(*) || ':' || coalesce(sum(points),0) from "PointHistory" where "userId" = ${userId}),
       (select count(*) || ':' || coalesce(sum(amount),0) from "BanhTransaction" where "userId" = ${userId}),
       (select count(*) from "SpeakingRewardLedger" where "userId" = ${userId}),
       (select coalesce(max("totalPoints"),0) from "Leaderboard" where "userId" = ${userId})`,
  )[0].join(' | ');
}

function azureLog() {
  try {
    return readFileSync(LOG, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function runCase(label: string, wav: string, recordMs: number) {
  console.log(`\n== ${label}`);
  const before = azureLog().filter((e) => e.event === 'azure-response').length;
  const { browser, page, account, issues } = await studentPage(
    `spk-live-${label.toLowerCase()}`,
    1366,
    false,
    [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${AUDIO}/${wav}`,
    ],
  );
  try {
    const ledgerBefore = ledger(account.userId);
    await page.goto(`${FE}/speaking/${EXERCISE}`);
    await hidePet(page);
    await page
      .getByRole('button', { name: 'Bắt đầu thu âm', exact: true })
      .first()
      .click();
    await sleep(recordMs);
    await page
      .getByRole('button', { name: 'Dừng ghi âm và chấm điểm' })
      .click();

    let row: string[] | undefined;
    for (let i = 0; i < 90; i += 1) {
      [row] = q(
        `select id, status, "overallScore", provider, "rewardStatus", "feedbackStatus", "lastErrorCode",
                "aiFeedback"->>'accuracyScore', "aiFeedback"->>'fluencyScore', "aiFeedback"->>'completenessScore',
                ("aiFeedback" ? 'prosodyScore')::text, "aiFeedback"->>'transcript', "aiFeedback"->>'feedback',
                (select count(*) from jsonb_array_elements(coalesce("aiFeedback"->'words','[]'::jsonb)) w where w->>'errorType' = 'Omission'),
                (select count(*) from jsonb_array_elements(coalesce("aiFeedback"->'words','[]'::jsonb))),
                "attemptCount"
           from "SpeakingSubmission" where "userId" = ${account.userId} and "exerciseId" = ${EXERCISE} order by id desc limit 1`,
      );
      if (
        row &&
        ['COMPLETED', 'FAILED'].includes(row[1]) &&
        row[5] !== 'PENDING' &&
        row[5] !== 'PROCESSING'
      )
        break;
      await sleep(1000);
    }
    await sleep(2500);
    const submissions = q(
      `select count(*) from "SpeakingSubmission" where "userId" = ${account.userId}`,
    )[0][0];
    const responses = azureLog().filter((e) => e.event === 'azure-response');
    const az = responses[responses.length - 1];
    const s = az?.scores ?? {};
    console.log(
      `  azure #${az?.n}: http ${az?.httpStatus}, ${az?.recognitionStatus}, ${az?.ms} ms, words ${az?.words}, errors ${JSON.stringify(az?.errorTypes)}`,
    );
    console.log(
      `  azure scores ${JSON.stringify(s)}; display "${az?.display}"`,
    );
    console.log(
      `  stored: status ${row?.[1]}, score ${row?.[2]}, provider ${row?.[3]}, reward ${row?.[4]}, feedback ${row?.[5]}, error ${row?.[6] || '-'}, acc ${row?.[7]}, flu ${row?.[8]}, comp ${row?.[9]}, prosodyKey ${row?.[10]}, omissions ${row?.[13]}/${row?.[14]}, attempts ${row?.[15]}`,
    );
    console.log(`  transcript "${row?.[11]}"`);
    console.log(`  feedback "${row?.[12]}"`);

    // Score the backend should have stored from Azure's own numbers.
    let expected = (Number(s.PronScore) / 100) * 10;
    if (Number(s.CompletenessScore) < 60)
      expected = Math.min(expected, (Number(s.CompletenessScore) / 100) * 10);
    expected = Number(Math.max(0, Math.min(10, expected)).toFixed(1));

    if (!DRY) {
      check(
        `${label}: exactly one new Azure operation reached the provider for this submission`,
        responses.length - before === 1 && az?.httpStatus === 200,
      );
      check(
        `${label}: Azure recognized speech (RecognitionStatus Success) and returned all scripted scores`,
        az?.recognitionStatus === 'Success' &&
          [
            'AccuracyScore',
            'FluencyScore',
            'CompletenessScore',
            'PronScore',
          ].every((k) => typeof s[k] === 'number' && s[k] >= 0 && s[k] <= 100),
      );
      check(
        `${label}: no prosody requested or fabricated (not enabled; key absent)`,
        s.ProsodyScore === null && row?.[10] === 'false',
      );
      check(
        `${label}: submission COMPLETED by provider azure, one submission`,
        row?.[1] === 'COMPLETED' && row?.[3] === 'azure' && submissions === '1',
        `(${row?.[1]}, ${row?.[3]}, ${submissions})`,
      );
      check(
        `${label}: stored score = PronScore/10 with the completeness cap (${expected})`,
        Number(row?.[2]) === expected,
        `(stored ${row?.[2]})`,
      );
      check(
        `${label}: stored metrics are Azure's raw values`,
        Number(row?.[7]) === s.AccuracyScore &&
          Number(row?.[8]) === s.FluencyScore &&
          Number(row?.[9]) === s.CompletenessScore,
      );
    } else
      check(
        `${label} (dry): mock submission COMPLETED, one submission`,
        row?.[1] === 'COMPLETED' && submissions === '1',
        `(${row?.[1]}, ${row?.[3]})`,
      );

    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({
      path: `${SHOTS}/spk-live-${label}-result.png`,
      fullPage: true,
    });
    check(
      `${label}: the result page shows the stored score and Azure's metrics`,
      text.includes(Number(row?.[2]).toFixed(1)) &&
        (DRY ||
          (text.includes(`${s.AccuracyScore}`) &&
            text.includes(`${s.CompletenessScore}`))),
    );
    const ledgerAfter = ledger(account.userId);
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(3000);
    await page.screenshot({
      path: `${SHOTS}/spk-live-${label}-after-refresh.png`,
      fullPage: true,
    });
    // The practice room opens fresh after a reload by design; the result is
    // kept in the learner's history (catalog best score, "previous attempt").
    const history = await call<any[]>(
      'GET',
      '/speaking/submissions/my',
      account.token,
    );
    const kept = (history.data ?? []).find(
      (x: any) => String(x.id) === String(row?.[0]),
    );
    const ledgerReload = ledger(account.userId);
    const xpRows = q(
      `select count(*) from "SpeakingRewardLedger" where "submissionId" = ${row?.[0]} and "rewardType" = 'XP'`,
    )[0][0];
    console.log(
      `  ledger before ${ledgerBefore} | after ${ledgerAfter} | after refresh ${ledgerReload}; XP rows ${xpRows}`,
    );
    check(
      `${label}: after refresh the history keeps the same result and nothing is graded again`,
      kept?.status === 'COMPLETED' &&
        Number(kept?.overallScore) === Number(row?.[2]) &&
        q(
          `select count(*) from "SpeakingSubmission" where "userId" = ${account.userId}`,
        )[0][0] === '1' &&
        (DRY ||
          azureLog().filter((e) => e.event === 'azure-response').length ===
            responses.length),
      `(history ${kept?.status} ${kept?.overallScore})`,
    );
    check(
      `${label}: rewards once: one XP row for the submission, ledgers unchanged by refresh`,
      ledgerAfter === ledgerReload && xpRows === '1',
      `(${ledgerReload}, XP rows ${xpRows})`,
    );
    const real = issues.filter(
      (i) => !/GSI_LOGGER|status of 403 \(\)$/.test(i),
    );
    check(`${label}: no page errors`, real.length === 0, real.join('; '));
    return { row, s, expected };
  } finally {
    await browser.close();
  }
}

async function main() {
  const start = azureLog().find((e) => e.event === 'start');
  if (!start && !DRY)
    throw new Error('REFUSED: the live Azure server has not started');
  const a = await runCase('A', 'a-full.wav', 6600);
  const b = await runCase('B', 'b-partial.wav', 4900);
  if (DRY) {
    console.log(`\nCP60_SPEAKING_DRY_FAILURES=${failureCount()}`);
    process.exit(failureCount() ? 1 : 0);
  }
  check(
    'B (half the sentence) has lower completeness than A and marks omitted words',
    Number(b.row?.[9]) < Number(a.row?.[9]) &&
      Number(b.row?.[13]) > Number(a.row?.[13]),
    `(completeness A ${a.row?.[9]} / B ${b.row?.[9]}, omissions A ${a.row?.[13]} / B ${b.row?.[13]})`,
  );
  const events = azureLog();
  const requests = events.filter((e) => e.event === 'azure-request');
  const refused = events.filter((e) => e.event === 'refused');
  const stubbed = events.filter(
    (e) => e.event === 'gemini-feedback-stubbed',
  ).length;
  console.log(
    `\nAzure operations ${requests.length}, refused ${refused.length}, Gemini feedback stubbed ${stubbed}`,
  );
  for (const r of requests)
    console.log(
      `  #${r.n} ${r.query} ${r.contentType} ${r.audioBytes} bytes, params ${JSON.stringify(r.assessment)}`,
    );
  check(
    'live budget: Azure operations <= 2, nothing refused (no retries, no other host)',
    requests.length <= 2 && refused.length === 0,
  );
  console.log(`\nCP60_SPEAKING_LIVE_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(2);
});
