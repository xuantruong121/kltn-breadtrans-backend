/**
 * TOEIC S&W and 4 Skills in Chromium on the disposable harness (deterministic
 * writing grader + mock Speaking evaluator on :3101).
 *
 *  - Speaking Q1 (read aloud): 45 s preparation shown, 45 s limit, start now.
 *  - Speaking Q5: the question audio plays by itself, then 3 s preparation,
 *    then recording starts by itself and stops at the 15 s limit.
 *  - Writing Q6 shows the e-mail it answers.
 *  - A 4 Skills attempt completed through the API shows per-skill results.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-toeic-sw-browser.ts <10s.wav> <34s.wav>
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots`;

async function main() {
  const wav = process.argv[2];
  const longWav = process.argv[3] ?? wav;
  const { browser, page, account } = await studentPage(
    'toeic-br',
    1366,
    false,
    [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  );
  const start = await call(
    'POST',
    '/toeic/assessments/1/attempts',
    account.token,
    { idempotencyKey: randomUUID() },
  );
  const attemptId = start.data.id;
  const sp = start.data.components.find((c: any) => c.kind === 'SPEAKING');
  const wr = start.data.components.find((c: any) => c.kind === 'WRITING');
  await call(
    'POST',
    `/toeic/assessments/attempts/${attemptId}/components/${sp.assessmentComponentId}/start`,
    account.token,
  );
  const ids: number[] = sp.speakingExerciseIds;
  const examUrl = (exerciseId: number) =>
    `${FE}/speaking/${exerciseId}?set=exam-3-speaking&parentAssessmentId=1&parentAttemptId=${attemptId}&parentComponentId=${sp.assessmentComponentId}&examExerciseIds=${ids.join(',')}`;

  // Q1: read aloud, 45 s preparation and 45 s answer.
  await page.goto(examUrl(ids[0]));
  await hidePet(page);
  await page.getByText('Thời gian chuẩn bị').waitFor({ timeout: 30_000 });
  const q1 = await page.locator('body').innerText();
  check('Q1 shows a 45 s preparation clock', /4[0-5]s/.test(q1));
  check(
    'Q1 states the 45 s answer limit',
    q1.includes('Thời gian trả lời tối đa 45 giây'),
  );
  await page.screenshot({ path: `${SHOTS}/toeic-q1-prep.png` });

  // Q5: audio question, 3 s preparation, automatic 15 s recording.
  const promptRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/exam-prompt/')) promptRequests.push(r.url());
  });
  await page.goto(examUrl(ids[4]));
  await hidePet(page);
  await page
    .getByText(/Đang thu âm/)
    .first()
    .waitFor({ timeout: 40_000 });
  check(
    'Q5 plays its question audio first',
    promptRequests.length > 0,
    String(promptRequests.length),
  );
  check('Q5 starts recording by itself after preparation', true);
  const t0 = Date.now();
  await page
    .getByText(/Đang thu âm/)
    .first()
    .waitFor({ state: 'detached', timeout: 30_000 });
  const recorded = (Date.now() - t0) / 1000;
  check(
    'Q5 recording stops by itself at the 15 s limit',
    recorded > 10 && recorded < 20,
    `${recorded.toFixed(1)} s`,
  );
  await page.waitForTimeout(8000);
  const lastKey = harnessQuery(
    `select "exerciseId", "durationMs", left("audioKey", 26) from "SpeakingSubmission" where "userId" = ${account.userId} order by id desc limit 1`,
  )[0];
  check(
    'the Q5 recording was uploaded privately and is at most 16.5 s',
    lastKey?.[0] === String(ids[4]) &&
      Number(lastKey?.[1]) <= 16_500 &&
      lastKey?.[2] === 'premium/speaking/practice/',
    JSON.stringify(lastKey),
  );
  await page.screenshot({ path: `${SHOTS}/toeic-q5-after.png` });

  // Writing Q6 shows its e-mail.
  await call(
    'POST',
    `/toeic/assessments/attempts/${attemptId}/components/${wr.assessmentComponentId}/start`,
    account.token,
  );
  await page.goto(
    `${FE}/writing/${wr.writingQuizIds[5]}?parentAssessmentId=1&parentAttemptId=${attemptId}&parentComponentId=${wr.assessmentComponentId}`,
  );
  await hidePet(page);
  await page.getByText('E-mail cần trả lời').waitFor({ timeout: 30_000 });
  check(
    'Writing Q6 shows the e-mail to answer',
    (await page.locator('body').innerText()).includes('From: Linh Tran'),
  );
  await page.screenshot({
    path: `${SHOTS}/toeic-writing-q6.png`,
    fullPage: true,
  });

  // 4 Skills completed through the API by this learner, then shown.
  const out = execFileSync(
    'npx',
    [
      'ts-node',
      '--transpile-only',
      'scripts/qa/finalization-toeic-full-api.ts',
      '2',
      wav,
      longWav,
    ],
    {
      env: {
        ...process.env,
        TOEIC_FULL_EMAIL: account.email,
        TOEIC_FULL_PASSWORD: account.password,
      },
      encoding: 'utf8',
      shell: true,
      timeout: 600_000,
    },
  );
  const full = /ATTEMPT (\d+)/.exec(out)?.[1];
  check(
    '4 Skills lifecycle completed for this learner',
    out.includes('ALL PASS') && !!full,
    out
      .split('\n')
      .filter((l) => l.startsWith('FAIL'))
      .join(' | '),
  );
  await page.goto(`${FE}/toeic/assessments/2/attempts/${full}`);
  await page
    .getByText(/Listening \d+ · Reading \d+ · Tổng \d+/)
    .waitFor({ timeout: 30_000 });
  const body = await page.locator('body').innerText();
  check(
    'the attempt page shows L&R, Speaking and Writing results',
    /Điểm luyện trung bình [\d.]+\/10/.test(body) &&
      /\d+\/28 điểm · đã chấm 8\/8 bài/.test(body),
    body.slice(0, 0),
  );
  check(
    'the result says it is a BreadTrans practice indicator, not ETS',
    body.includes('không phải điểm thi chính thức của ETS'),
  );
  await page.screenshot({
    path: `${SHOTS}/toeic-4skills-result.png`,
    fullPage: true,
  });
  await page.reload();
  await page
    .getByText(/Listening \d+ · Reading \d+/)
    .waitFor({ timeout: 30_000 });
  check('results survive a reload', true);
  await browser.close();
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

void main();
