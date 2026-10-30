/**
 * CP60 provider closeout (owner-authorized: Azure <= 2 operations, Gemini <= 2
 * requests, <= 3,000 VND). Harness only; the backend runs
 * speaking-live-azure-server.ts in `azuregemini` mode (Azure REST + SDK share
 * one cap, Gemini capped, every other host refused).
 *
 *  A  /speaking/1  READ_ALOUD (scripted): real Azure REST pronunciation
 *     assessment, then real Gemini feedback rewording in post-processing.
 *     Also the real-data regression of the required-metric validation.
 *  C  /speaking/16 RESPOND_TO_QUESTION (free speaking): real Azure SDK
 *     unscripted continuous assessment; no Gemini for free answers.
 * Audio: synthetic Windows TTS through Chromium's fake microphone.
 *
 *   HARNESS_DB=diag_clone AUDIO_DIR=<dir> LIVE_LOG=<jsonl> SHOTS=<dir> [DRY=1] \
 *     npx ts-node --transpile-only scripts/qa/cp60-provider-closeout-browser.ts
 */
import { readFileSync } from 'node:fs';

import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const AUDIO = process.env.AUDIO_DIR!;
const LOG = process.env.LIVE_LOG!;
const SHOTS = process.env.SHOTS ?? '.';
const DRY = process.env.DRY === '1';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const q = (sql: string) => harnessQuery(sql);
const VI = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

function events(kind?: string) {
  let all: any[] = [];
  try {
    all = readFileSync(LOG, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    /* no log in a dry run */
  }
  return kind ? all.filter((e) => e.event === kind) : all;
}

function ledger(userId: number) {
  return q(
    `select
       (select count(*) || ':' || coalesce(sum(points),0) from "PointHistory" where "userId" = ${userId}),
       (select count(*) || ':' || coalesce(sum(amount),0) from "BanhTransaction" where "userId" = ${userId}),
       (select count(*) from "SpeakingRewardLedger" where "userId" = ${userId})`,
  )[0].join(' | ');
}

function stored(userId: number) {
  const [r] = q(
    `select id, status, "overallScore", provider, "rewardStatus", "feedbackStatus", coalesce("feedbackError",''), coalesce("lastErrorCode",''),
            "aiFeedback"->>'accuracyScore', "aiFeedback"->>'fluencyScore', "aiFeedback"->>'completenessScore',
            ("aiFeedback" ? 'completenessScore')::text, "aiFeedback"->>'transcript', "aiFeedback"->>'feedback',
            coalesce("aiFeedback"->'suggestions','[]'::jsonb)::text, coalesce(jsonb_array_length("aiFeedback"->'problematicWords'),0), "attemptCount"
       from "SpeakingSubmission" where "userId" = ${userId} order by id desc limit 1`,
  );
  return r
    ? {
        id: r[0],
        status: r[1],
        score: r[2] === '' ? null : Number(r[2]),
        provider: r[3],
        reward: r[4],
        feedbackStatus: r[5],
        feedbackError: r[6],
        lastError: r[7],
        accuracy: r[8] === '' ? null : Number(r[8]),
        fluency: r[9] === '' ? null : Number(r[9]),
        completeness: r[10] === '' ? null : Number(r[10]),
        hasCompleteness: r[11] === 'true',
        transcript: r[12],
        feedback: r[13],
        suggestions: JSON.parse(r[14] || '[]') as string[],
        problematicWords: Number(r[15]),
        attempts: Number(r[16]),
      }
    : undefined;
}

async function runCase(opts: {
  label: string;
  exercise: number;
  wav: string;
  recordMs: number;
  scripted: boolean;
}) {
  const { label } = opts;
  console.log(`\n== ${label}: /speaking/${opts.exercise}`);
  const before = {
    rest: events('azure-response').length,
    sdk: events('azure-sdk-evidence').length,
    gemini: events('gemini-response').length,
  };
  const s = await studentPage(`closeout-${label.toLowerCase()}`, 1366, false, [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${AUDIO}/${opts.wav}`,
  ]);
  try {
    const ledgerBefore = ledger(s.account.userId);
    await s.page.goto(`${FE}/speaking/${opts.exercise}`);
    await hidePet(s.page);
    await s.page
      .getByRole('button', { name: 'Bắt đầu thu âm', exact: true })
      .first()
      .click();
    await sleep(opts.recordMs);
    await s.page
      .getByRole('button', { name: 'Dừng ghi âm và chấm điểm' })
      .click();

    let r = stored(s.account.userId);
    const scoredAt = Date.now();
    let scoreAtCompletion: number | null = null;
    for (let i = 0; i < 150; i += 1) {
      r = stored(s.account.userId);
      if (r?.status === 'COMPLETED' && scoreAtCompletion === null)
        scoreAtCompletion = r.score;
      if (
        r &&
        ['COMPLETED', 'FAILED'].includes(r.status) &&
        !['PENDING', 'PROCESSING'].includes(r.feedbackStatus) &&
        !['PENDING', 'PROCESSING'].includes(r.reward)
      )
        break;
      await sleep(1000);
    }
    await sleep(2500);
    r = stored(s.account.userId);
    console.log(
      `  stored ${JSON.stringify(r)} (settled in ${Math.round((Date.now() - scoredAt) / 1000)} s)`,
    );
    const rest = events('azure-response').slice(before.rest);
    const sdk = events('azure-sdk-evidence').slice(before.sdk);
    const gemini = events('gemini-response').slice(before.gemini);
    for (const e of rest)
      console.log(
        `  azure REST: http ${e.httpStatus} ${e.recognitionStatus} ${JSON.stringify(e.scores)} words ${e.words} ${JSON.stringify(e.errorTypes)}`,
      );
    for (const e of sdk)
      console.log(
        `  azure SDK: ${e.mode} ${e.locale} ${JSON.stringify(e.azure)} words ${e.recognizedWordCount} segments ${e.segmentCount} wpm ${e.speechRateWpm} pauses ${e.longPauseCount}; "${e.transcript}"`,
      );
    for (const e of gemini)
      console.log(
        `  gemini: http ${e.httpStatus} ${e.ms} ms model ${e.model} usage ${JSON.stringify(e.usage)}`,
      );

    check(
      `${label}: submission COMPLETED once by provider azure, no provider error`,
      r?.status === 'COMPLETED' &&
        r.provider === (DRY ? 'mock' : 'azure') &&
        r.lastError === '' &&
        q(
          `select count(*) from "SpeakingSubmission" where "userId" = ${s.account.userId}`,
        )[0][0] === '1',
      JSON.stringify(
        r && { status: r.status, provider: r.provider, lastError: r.lastError },
      ),
    );

    if (!DRY && opts.scripted) {
      const sc = rest[0]?.scores ?? {};
      let expected = (sc.PronScore / 100) * 10;
      if (sc.CompletenessScore < 60)
        expected = Math.min(expected, sc.CompletenessScore / 10);
      expected = Number(Math.max(0, Math.min(10, expected)).toFixed(1));
      check(
        `${label}: exactly one Azure REST operation, Success, four required scores valid (accepted by the fixed validation)`,
        rest.length === 1 &&
          sdk.length === 0 &&
          rest[0].httpStatus === 200 &&
          rest[0].recognitionStatus === 'Success' &&
          [
            'AccuracyScore',
            'FluencyScore',
            'CompletenessScore',
            'PronScore',
          ].every(
            (k) => typeof sc[k] === 'number' && sc[k] >= 0 && sc[k] <= 100,
          ),
      );
      check(
        `${label}: stored score = PronScore/10 with the completeness cap (${expected}); metrics are Azure's`,
        r?.score === expected &&
          r.accuracy === sc.AccuracyScore &&
          r.fluency === sc.FluencyScore &&
          r.completeness === sc.CompletenessScore,
        `(stored ${r?.score}, ${r?.accuracy}/${r?.fluency}/${r?.completeness})`,
      );
      // Gemini rewording.
      const text = gemini[0]?.text ?? '';
      const parsed = (() => {
        try {
          return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? 'null');
        } catch {
          return null;
        }
      })();
      console.log(
        `  gemini feedback: "${parsed?.feedback}" suggestions ${JSON.stringify(parsed?.suggestions)}`,
      );
      check(
        `${label}: Gemini was called (<= 2 requests) and returned feedback JSON`,
        gemini.length >= 1 &&
          gemini.length <= 2 &&
          gemini[0].httpStatus === 200 &&
          typeof parsed?.feedback === 'string',
      );
      check(
        `${label}: persisted feedback is Gemini's Vietnamese wording; feedback COMPLETED`,
        r?.feedbackStatus === 'COMPLETED' &&
          r.feedback === parsed?.feedback.trim() &&
          VI.test(r.feedback),
        `(${r?.feedbackStatus}) "${r?.feedback}"`,
      );
      check(
        `${label}: Gemini changed no score or metric (score at completion = after feedback)`,
        scoreAtCompletion === r?.score && r?.accuracy === sc.AccuracyScore,
      );
      const allowed = new Set(
        [
          sc.AccuracyScore,
          sc.FluencyScore,
          sc.CompletenessScore,
          sc.PronScore,
          expected,
          10,
          100,
        ].flatMap((n) => [String(n), String(n).replace('.', ',')]),
      );
      const numbers =
        `${r?.feedback} ${r?.suggestions.join(' ')}`.match(
          /\d+(?:[.,]\d+)?/g,
        ) ?? [];
      check(
        `${label}: Gemini wording invents no acoustic measurement (numbers only from Azure's result)`,
        numbers.every((n) => allowed.has(n)),
        `numbers ${JSON.stringify(numbers)}`,
      );
    }
    if (!DRY && !opts.scripted) {
      const ev = sdk[0];
      const expected = ev
        ? Math.max(
            0,
            Math.min(10, Number((ev.azure.pronunciation / 10).toFixed(1))),
          )
        : NaN;
      check(
        `${label}: exactly one Azure SDK unscripted continuous session, en-US, no REST call, no reference text`,
        sdk.length === 1 &&
          rest.length === 0 &&
          ev.mode === 'UNSCRIPTED_CONTINUOUS' &&
          ev.locale === 'en-US',
      );
      check(
        `${label}: real recognized speech with Azure accuracy/fluency/pronunciation in 0-100 (prosody optional)`,
        !!ev &&
          ev.recognizedWordCount >= 5 &&
          ['accuracy', 'fluency', 'pronunciation'].every(
            (k) =>
              typeof ev.azure[k] === 'number' &&
              ev.azure[k] >= 0 &&
              ev.azure[k] <= 100,
          ) &&
          (ev.azure.prosody === null ||
            (ev.azure.prosody >= 0 && ev.azure.prosody <= 100)),
      );
      check(
        `${label}: stored score = pronunciation/10 (${expected}); metrics from Azure; no scripted metrics`,
        r?.score === expected &&
          r.accuracy === Math.round(ev.azure.accuracy) &&
          r.fluency === Math.round(ev.azure.fluency) &&
          !r.hasCompleteness &&
          r.problematicWords === 0 &&
          r.transcript === ev.transcript,
        `(stored ${r?.score}, completeness key ${r?.hasCompleteness}, problematic ${r?.problematicWords})`,
      );
      check(
        `${label}: free answers are not sent to Gemini; feedback names the free-answer mode`,
        gemini.length === 0 && /trả lời tự do/.test(r?.feedback ?? ''),
        `"${r?.feedback}"`,
      );
    }

    const page = (await s.page.locator('body').innerText()).replace(
      /\s+/g,
      ' ',
    );
    await s.page.screenshot({
      path: `${SHOTS}/closeout-${label}-result.png`,
      fullPage: true,
    });
    check(
      `${label}: the result page shows the stored score${opts.scripted && !DRY ? ' and the feedback' : ''}`,
      r?.score !== null &&
        r?.score !== undefined &&
        page.includes(r.score.toFixed(1)) &&
        (!opts.scripted ||
          DRY ||
          page.includes((r.feedback ?? '').slice(0, 25))),
    );
    const ledgerAfter = ledger(s.account.userId);
    await s.page.reload({ waitUntil: 'networkidle' });
    await sleep(2500);
    await s.page.screenshot({
      path: `${SHOTS}/closeout-${label}-after-refresh.png`,
      fullPage: true,
    });
    const history = await call<any[]>(
      'GET',
      '/speaking/submissions/my',
      s.account.token,
    );
    const kept = (history.data ?? []).find(
      (x: any) => String(x.id) === String(r?.id),
    );
    const xp = q(
      `select count(*) from "SpeakingRewardLedger" where "submissionId" = ${r?.id} and "rewardType" = 'XP'`,
    )[0][0];
    const ledgerReload = ledger(s.account.userId);
    console.log(
      `  ledger before ${ledgerBefore} | after ${ledgerAfter} | after refresh ${ledgerReload}; XP rows ${xp}`,
    );
    check(
      `${label}: refresh keeps the result in history; no new grading`,
      kept?.status === 'COMPLETED' &&
        Number(kept.overallScore) === r?.score &&
        (DRY ||
          events('azure-response').length +
            events('azure-sdk-evidence').length ===
            before.rest + before.sdk + rest.length + sdk.length),
    );
    check(
      `${label}: XP settled exactly once; refresh changes no ledger`,
      xp === '1' && ledgerAfter === ledgerReload,
      `(${ledgerReload}, XP ${xp})`,
    );
    const real = s.issues.filter(
      (i) => !/GSI_LOGGER|status of 403 \(\)$/.test(i),
    );
    check(`${label}: no page errors`, real.length === 0, real.join('; '));
  } finally {
    await s.browser.close();
  }
}

async function main() {
  if (!DRY && !events('start').length)
    throw new Error('REFUSED: the live server log has no start record');
  await runCase({
    label: 'A',
    exercise: 1,
    wav: 'a-full.wav',
    recordMs: 6600,
    scripted: true,
  });
  await runCase({
    label: 'C',
    exercise: 16,
    wav: 'c-free.wav',
    recordMs: 18200,
    scripted: false,
  });
  if (!DRY) {
    const azure =
      events('azure-request').length + events('azure-sdk-session').length;
    const gem = events('gemini-request').length;
    const refused = events('refused').length;
    const usage = events('gemini-response').reduce(
      (a, e) => ({
        input: a.input + (e.usage?.promptTokenCount ?? 0),
        output:
          a.output +
          (e.usage?.candidatesTokenCount ?? 0) +
          (e.usage?.thoughtsTokenCount ?? 0),
      }),
      { input: 0, output: 0 },
    );
    console.log(
      `\nAzure operations ${azure} (REST ${events('azure-request').length}, SDK ${events('azure-sdk-session').length}), Gemini ${gem}, refused ${refused}; Gemini tokens in ${usage.input} out ${usage.output}`,
    );
    check(
      'caps held: Azure <= 2, Gemini <= 2, total <= 4, nothing refused',
      azure <= 2 && gem <= 2 && azure + gem <= 4 && refused === 0,
    );
  }
  console.log(
    `\nCP60_PROVIDER_CLOSEOUT${DRY ? '_DRY' : ''}_FAILURES=${failureCount()}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(2);
});
