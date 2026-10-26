/**
 * Entry Diagnostic V2 (FOUR_SKILL_PLACEMENT_V2, assessment id 5) end to end in
 * a real browser on the disposable harness, with the MOCK grader.
 *
 * Preconditions (clone only, never kltn_db):
 *   - id 5 swapped to ACTIVE on harness_clone (id 1 to READY);
 *   - listening questions on stand-in audio (diagnostic-v2-listening-audio.ts
 *     harness-fixture), which is NOT the script audio;
 *   - harness backend with DIAGNOSTIC_GRADER_MODE=mock and the private bucket
 *     on the local fake S3.
 * Chromium's fake microphone supplies the recordings (a synthetic tone), so
 * the speaking scores prove the pipeline, not any spoken English.
 *
 * Second phase: two graded rows are set to GRADING_FAILED on the clone (a
 * simulated provider failure) to prove the withheld overall and the retry
 * path through the UI.
 */
import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const EVIDENCE = 'artifacts/finalization/evidence';
const FAKE_MIC = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
];

const norm = (t: string) =>
  t
    .replace(/^\d+\.\s*/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function optionsOf(raw: any): string[] {
  return Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.values)
      ? raw.values
      : [];
}

const words = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      [
        'I',
        'usually',
        'study',
        'English',
        'after',
        'work',
        'because',
        'it',
        'helps',
        'me',
        'talk',
        'with',
        'customers',
        'and',
        'read',
        'reports',
      ][i % 16],
  ).join(' ');

type Item = {
  id: number;
  section: string;
  taskType: string;
  options: string[];
  key: number;
  prep: number | null;
  response: number | null;
  wordMin: number | null;
  wordMax: number | null;
};

async function waitFor<T>(
  probe: () => Promise<T>,
  ok: (v: T) => boolean,
  ms: number,
): Promise<T> {
  const until = Date.now() + ms;
  let value = await probe();
  while (!ok(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    value = await probe();
  }
  return value;
}

async function main() {
  console.log('\n== Entry Diagnostic V2 id 5 (browser, mock grader)');
  const [active] = harnessQuery(
    `select id, status, "scoringVersion" from "DiagnosticAssessment" where "isActive" = true`,
  );
  check(
    'the clone serves V2 id 5 as the active assessment',
    active?.[0] === '5' && active?.[2] === 'FOUR_SKILL_PLACEMENT_V2',
    `(${active?.join(' / ')})`,
  );
  const bank = new Map<string, Item>(
    harnessQuery(
      `select id, question, options::text, "correctIndex", "taskType", "prepSeconds", "responseSeconds", "wordMin", "wordMax" from "DiagnosticQuestion" where "assessmentId" = 5`,
    ).map(([id, q, o, k, t, p, r, wmin, wmax]) => {
      const raw = JSON.parse(o);
      return [
        norm(q),
        {
          id: Number(id),
          section: raw?.section ?? '?',
          taskType: t,
          options: optionsOf(raw),
          key: Number(k),
          prep: p ? Number(p) : null,
          response: r ? Number(r) : null,
          wordMin: wmin ? Number(wmin) : null,
          wordMax: wmax ? Number(wmax) : null,
        },
      ];
    }),
  );
  const total = bank.size;

  const { browser, page, account, issues } = await studentPage(
    'diag-v2',
    1366,
    false,
    FAKE_MIC,
  );
  await page.goto(`${FE}/diagnostic`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await hidePet(page);
  const intro = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the intro counts the administered form, not the 52-task plan',
    intro.includes('29 nhiệm vụ (25 trắc nghiệm + 4 thực hành)') &&
      !/52 nhiệm vụ|48 trắc nghiệm/.test(intro),
    `(${intro.match(/\d+ nhiệm vụ[^)]*\)/)?.[0]})`,
  );
  await page.getByRole('button', { name: /Bắt đầu làm bài/ }).click();
  await page.waitForTimeout(3000);

  const correct: Record<string, number> = {};
  let speakingSeen = 0;
  let writingSeen = 0;
  let answered = 0;
  for (let i = 0; i < total; i += 1) {
    const prompts = await page.locator('h2').allInnerTexts();
    const prompt = prompts.map(norm).find((t) => bank.has(t));
    if (!prompt) {
      check(
        `question ${i + 1} is one of id 5's items`,
        false,
        `(${prompts.join(' | ').slice(0, 160)})`,
      );
      break;
    }
    const item = bank.get(prompt)!;
    const body = () => page.locator('body').innerText();

    if (item.taskType === 'SPEAKING_RESPONSE') {
      speakingSeen += 1;
      const text = (await body()).replace(/\s+/g, ' ');
      check(
        `speaking ${speakingSeen}: the stated limits are the task's own (prep ${item.prep}s, ${item.response}s)`,
        text.includes(
          item.prep
            ? `Chuẩn bị ${item.prep} giây, sau đó nói tối đa ${item.response} giây`
            : `Thời lượng tối đa ${item.response} giây`,
        ),
      );
      if (speakingSeen === 1) {
        // Preparation countdown, then recording starts by itself.
        await page.getByRole('button', { name: /Bắt đầu chuẩn bị/ }).click();
        check(
          'speaking 1: the preparation countdown is shown',
          await page.getByText(/Thời gian chuẩn bị còn \d+s/).isVisible(),
        );
        await page
          .getByText(/Đang ghi âm/)
          .waitFor({ timeout: ((item.prep ?? 0) + 10) * 1000 });
        check('speaking 1: recording started when preparation ended', true);
        await page.waitForTimeout(3000);
        await page.getByRole('button', { name: /Dừng ghi âm/ }).click();
        await page.getByLabel('Nghe lại bài nói').waitFor({ timeout: 10_000 });
        check(
          'speaking 1: the take can be played back before confirming',
          true,
        );
        // Re-record, then confirm the second take.
        await page.getByRole('button', { name: /Ghi âm lại/ }).click();
        await page.getByRole('button', { name: /Ghi âm ngay/ }).click();
        await page.waitForTimeout(4000);
        await page.getByRole('button', { name: /Dừng ghi âm/ }).click();
      } else {
        // Recording stops itself at the task's responseSeconds.
        await page
          .getByRole('button', { name: /Ghi âm ngay|Bắt đầu ghi âm/ })
          .click();
        await page
          .getByLabel('Nghe lại bài nói')
          .waitFor({ timeout: ((item.response ?? 90) + 15) * 1000 });
        check(
          `speaking 2: recording stopped by itself at ${item.response}s`,
          !(await page.getByText(/Đang ghi âm/).isVisible()),
        );
      }
      await page.getByLabel('Nghe lại bài nói').waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: /Xác nhận & tiếp tục/ }).click();
      await page.waitForTimeout(3000);
      answered += 1;
      continue;
    }

    if (item.taskType === 'WRITING_RESPONSE') {
      writingSeen += 1;
      const box = page.getByLabel('Câu trả lời tự luận');
      const range = `${item.wordMin}–${item.wordMax} từ`;
      check(
        `writing ${writingSeen}: guidance states the task's range (${range})`,
        await page.getByText(`Gợi ý độ dài: ${range}.`).isVisible(),
      );
      await box.fill(words(10));
      check(
        `writing ${writingSeen}: a short draft is told it is below the range but still graded`,
        await page.getByText(/10 từ · gợi ý .*vẫn được chấm/).isVisible(),
      );
      const n = (item.wordMin ?? 60) + 5;
      await box.fill(words(n));
      check(
        `writing ${writingSeen}: ${n} words reads as within the range`,
        await page
          .getByText(`${n} từ · trong khoảng gợi ý ${range}.`)
          .isVisible(),
      );
      await page.getByRole('button', { name: /^Câu tiếp/ }).click();
      await page.waitForTimeout(500);
      answered += 1;
      continue;
    }

    if (item.section === 'LISTENING' && i === 0) {
      const src = await page
        .locator('audio[aria-label="Âm thanh bài nghe"]')
        .getAttribute('src');
      check(
        'listening: the question carries playable audio (stand-in fixture)',
        !!src,
        `(${src?.slice(-40)})`,
      );
    }
    const keyText = item.options[item.key];
    const choice =
      i % 2 === 0 ? keyText : item.options.find((o) => o !== keyText)!;
    if (choice === keyText)
      correct[item.section] = (correct[item.section] ?? 0) + 1;
    await page.getByRole('button').filter({ hasText: choice }).first().click();
    answered += 1;
    await page.waitForTimeout(500);
  }
  check(
    `all ${total} tasks answered through the UI`,
    answered === total,
    `(${answered})`,
  );
  await page.getByRole('button', { name: /Hoàn thành & nộp bài/ }).click();
  await page.waitForTimeout(4000);

  // Grading runs on the mock grader through the real queue and worker.
  const latest = () => call('GET', '/diagnostic/results/latest', account.token);
  let res = await waitFor(
    latest,
    (r) => r.data?.fourSkill?.state === 'COMPLETE',
    180_000,
  );
  const fs = res.data?.fourSkill;
  check(
    'the four-skill result reaches COMPLETE',
    fs?.state === 'COMPLETE',
    `(${fs?.state})`,
  );
  const pct = (n = 0) => Math.round((n / 10) * 100);
  check(
    'Listening and Reading equal the keyed answers',
    fs?.skills.LISTENING.score === pct(correct.LISTENING) &&
      fs?.skills.READING.score === pct(correct.READING),
    `(L ${fs?.skills.LISTENING.score} vs ${pct(correct.LISTENING)}, R ${fs?.skills.READING.score} vs ${pct(correct.READING)})`,
  );
  const graded = (table: string) =>
    harnessQuery(
      `select score from "${table}" r join "DiagnosticAttempt" a on a.id = r."attemptId" where a.id = ${res.data?.attemptId} and r.status = 'GRADED'`,
    ).map(([s]) => Number(s));
  const mean = (xs: number[]) =>
    Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const speakingScores = graded('DiagnosticSpeakingResponse');
  const writingScores = graded('DiagnosticWritingResponse');
  check(
    'Speaking and Writing equal the mean of their graded tasks',
    speakingScores.length === 2 &&
      writingScores.length === 2 &&
      fs?.skills.SPEAKING.score === mean(speakingScores) &&
      fs?.skills.WRITING.score === mean(writingScores),
    `(S ${fs?.skills.SPEAKING.score} [${speakingScores.join(',')}], W ${fs?.skills.WRITING.score} [${writingScores.join(',')}])`,
  );
  const overall = Math.round(
    (fs.skills.LISTENING.score +
      fs.skills.READING.score +
      fs.skills.SPEAKING.score +
      fs.skills.WRITING.score) /
      4,
  );
  check(
    'overall is the equal-weight mean of the four skills',
    fs?.overall === overall,
    `(${fs?.overall} vs ${overall})`,
  );
  check(
    'Language Use is reported with weight 0',
    fs?.skills.LANGUAGE_USE.weight === 0 &&
      fs?.skills.LANGUAGE_USE.itemsScored === (correct.LANGUAGE_USE ?? 0),
  );
  check(
    'no placement band while DEF-004 is open',
    fs?.placementBand === null &&
      fs?.placementBandStatus === 'WITHHELD_DEF_004_OPEN',
  );
  const [attempt] = harnessQuery(
    `select "scoringVersion", "blueprintVersion", "contentVersion", "resultState", "overallScore", (select count(*) from "DiagnosticSkillResult" s where s."attemptId" = a.id) from "DiagnosticAttempt" a where id = ${res.data?.attemptId}`,
  );
  check(
    'the attempt pins its versions and stores the result',
    attempt?.[0] === 'FOUR_SKILL_PLACEMENT_V2' &&
      attempt?.[1] === 'V2_2026_01' &&
      attempt?.[2] === '6' &&
      attempt?.[3] === 'COMPLETE' &&
      Number(attempt?.[4]) === overall &&
      attempt?.[5] === '5',
    `(${attempt?.join(' / ')})`,
  );

  await page.reload({ waitUntil: 'networkidle' });
  await hidePet(page);
  let text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'after a reload the result page shows the four-skill profile and overall',
    text.includes('Kết quả theo bốn kỹ năng') &&
      text.includes(`Điểm tổng tham khảo: ${overall}/100`),
  );
  // Claims are checked in the result view's own sections, not the site
  // navigation (which links the TOEIC practice area by name).
  const resultText = (await page.locator('section').allInnerTexts())
    .join(' ')
    .replace(/\s+/g, ' ');
  check(
    'task scores use the 0-100 scale, never /5',
    // "1/5 câu đúng" is an item count (Language Use has 5 items), not a scale.
    !/\b\d+(\.\d+)?\/5\b(?! câu)/.test(resultText),
    `(${resultText.match(/.{40}\b\d+(\.\d+)?\/5\b(?! câu).{20}/)?.[0]})`,
  );
  check(
    'the answer review never shows a grading status as an answer',
    !/Bạn chọn: (GRADED|GRADING_FAILED|SUBMITTED|QUEUED|GRADING|SKIPPED)/.test(
      resultText,
    ) && resultText.includes('Chấm theo tiêu chí'),
  );
  check(
    'per-criterion feedback is shown on a 0-4 scale',
    /\d\/4/.test(text) && text.includes('Hoàn thành yêu cầu'),
  );
  check(
    'no CEFR or official-score claim',
    !/CEFR|TOEIC|IELTS|\bETS\b/.test(resultText),
    `(${resultText.match(/.{20}(CEFR|TOEIC|IELTS|\bETS\b).{20}/)?.[0]})`,
  );
  await page.screenshot({
    path: `${EVIDENCE}/diag-v2-result-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check(
    'the result page has no horizontal scroll at 390px',
    overflow <= 1,
    `(${overflow}px)`,
  );
  await page.screenshot({
    path: `${EVIDENCE}/diag-v2-result-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 900 });

  // Phase 2: simulated provider failure on the clone, then retry in the UI.
  const sId = [...bank.values()].find(
    (q) => q.taskType === 'SPEAKING_RESPONSE',
  )!.id;
  const wId = [...bank.values()].filter(
    (q) => q.taskType === 'WRITING_RESPONSE',
  )[1].id;
  harnessExec(
    `begin;
     update "DiagnosticSpeakingResponse" set status = 'GRADING_FAILED', score = null, "failureReason" = 'HARNESS_SIMULATED_FAILURE' where "attemptId" = ${res.data.attemptId} and "questionId" = ${sId};
     update "DiagnosticWritingResponse" set status = 'GRADING_FAILED', score = null, "failureReason" = 'HARNESS_SIMULATED_FAILURE' where "attemptId" = ${res.data.attemptId} and "questionId" = ${wId};
     commit;`,
  );
  res = await latest();
  check(
    'a failed task withholds its skill and the overall (never 0)',
    res.data?.fourSkill?.state === 'GRADING_FAILED' &&
      res.data?.fourSkill?.overall === null &&
      res.data?.fourSkill?.skills.SPEAKING.score === null &&
      res.data?.fourSkill?.skills.WRITING.score === null,
    `(${res.data?.fourSkill?.state}, overall ${res.data?.fourSkill?.overall})`,
  );
  const [stored] = harnessQuery(
    `select "resultState", "overallScore" from "DiagnosticAttempt" where id = ${res.data.attemptId}`,
  );
  check(
    'the stored attempt follows (GRADING_FAILED, no overall)',
    stored?.[0] === 'GRADING_FAILED' && stored?.[1] === '',
    `(${stored?.join(' / ')})`,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await hidePet(page);
  text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the page says the overall is withheld and offers a retry per failed task',
    text.includes('Điểm tổng chưa hiển thị') &&
      (await page.getByRole('button', { name: /Chấm lại/ }).count()) === 2,
  );
  await page.screenshot({
    path: `${EVIDENCE}/diag-v2-grading-failed.png`,
    fullPage: true,
  });
  await page
    .getByRole('button', { name: /Chấm lại/ })
    .first()
    .click();
  await page.waitForTimeout(1500);
  await page
    .getByRole('button', { name: /Chấm lại/ })
    .first()
    .click();
  res = await waitFor(
    latest,
    (r) => r.data?.fourSkill?.state === 'COMPLETE',
    180_000,
  );
  check(
    'both retries regrade through the queue and the overall returns',
    res.data?.fourSkill?.state === 'COMPLETE' &&
      typeof res.data?.fourSkill?.overall === 'number',
    `(${res.data?.fourSkill?.state}, overall ${res.data?.fourSkill?.overall})`,
  );
  await page.reload({ waitUntil: 'networkidle' });
  text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the page shows the restored overall',
    text.includes(`Điểm tổng tham khảo: ${res.data?.fourSkill?.overall}/100`),
  );

  check(
    'no server error during the run',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api 5')).join(' | '),
  );
  console.log(
    `issues: ${issues.length ? issues.slice(0, 8).join(' | ') : 'none'}`,
  );
  await browser.close();
  console.log(`\nDIAGNOSTIC_V2_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
