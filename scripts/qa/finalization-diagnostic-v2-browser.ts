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
import { call, check, failureCount, newStudent } from './harness-api';
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
  prompt: string;
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

/**
 * After a reload or navigation, wait for the page's own content instead of
 * reading at networkidle: a cold dev server renders the result page late
 * (CP60.2 flake). A page that never renders still fails its check.
 */
async function settled(page: import('playwright').Page) {
  await page
    .waitForFunction(
      () =>
        (document.querySelector('main')?.textContent ?? '').trim().length > 400,
      undefined,
      { timeout: 60_000 },
    )
    .catch(() => undefined);
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
          prompt: q,
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
  await page
    .getByText(/\d+ nhiệm vụ/)
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => undefined);
  const intro = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the intro counts the administered form, not the 52-task plan',
    intro.includes('29 nhiệm vụ (25 trắc nghiệm + 4 thực hành)') &&
      !/52 nhiệm vụ|48 trắc nghiệm/.test(intro),
    `(${intro.match(/\d+ nhiệm vụ[^)]*\)/)?.[0]})`,
  );
  // Client-reported vs server-decoded recording length (the owner's 400).
  await page.evaluate(() => {
    const w = window as unknown as { __durations?: number[] };
    w.__durations = [];
    const original = FormData.prototype.append;
    FormData.prototype.append = function (
      this: FormData,
      name: string,
      value: string | Blob,
      ...rest: [string?]
    ) {
      if (name === 'durationMs') w.__durations!.push(Number(value));
      return (original as (...args: unknown[]) => void).call(
        this,
        name,
        value,
        ...rest,
      );
    } as typeof FormData.prototype.append;
  });
  const reportedDurations = () =>
    page.evaluate(
      () => (window as unknown as { __durations?: number[] }).__durations ?? [],
    );
  await page.getByRole('button', { name: /Bắt đầu làm bài/ }).click();
  await page.waitForTimeout(3000);
  const sidebar = (
    await page.locator('aside[aria-label="Danh sách câu hỏi"]').innerText()
  ).replace(/\s+/g, ' ');
  const order = [
    'Nghe · câu 1–10',
    'Đọc · câu 11–20',
    'Nói · câu 21–22',
    'Viết · câu 23–24',
    'Ngữ pháp & Từ vựng · câu 25–29',
  ];
  const positions = order.map((label) => sidebar.indexOf(label));
  check(
    'desktop sidebar lists the sections in the assessment order',
    positions.every(
      (pos, i) => pos >= 0 && (i === 0 || pos > positions[i - 1]),
    ),
    `(${positions.join(',')})`,
  );

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
        `speaking ${speakingSeen}: no preparation step, no confirm button`,
        !/Bắt đầu chuẩn bị|Ghi âm ngay|Xác nhận & tiếp tục/.test(text) &&
          (await page.getByRole('button', { name: /^Ghi âm$/ }).isVisible()),
      );
      const record = async (holdMs: number | null) => {
        await page.getByRole('button', { name: /^(Ghi âm|Ghi lại)$/ }).click();
        await page.getByText(/Đang ghi âm/).waitFor({ timeout: 15_000 });
        if (holdMs !== null) {
          await page.waitForTimeout(holdMs);
          await page.getByRole('button', { name: /Dừng ghi âm/ }).click();
        }
        // An accepted recording moves the page to the next task.
        await page.waitForFunction(
          (prompt) =>
            !Array.from(document.querySelectorAll('h2')).some((h) =>
              (h.textContent ?? '').replace(/s+/g, ' ').includes(prompt),
            ),
          item.prompt.replace(/s+/g, ' ').slice(0, 60),
          { timeout: ((item.response ?? 90) + 30) * 1000 },
        );
      };
      // Speaking tasks have no "Câu trước"; go back through the navigator.
      const backToTask = async () => {
        const aside = page.locator('aside[aria-label="Danh sách câu hỏi"]');
        const n = Number(/Câu (\d+)\/29/.exec(await aside.innerText())?.[1]);
        await aside
          .getByRole('button', { name: new RegExp(`^Câu ${n - 1},`) })
          .click();
        await page.waitForTimeout(500);
      };
      if (speakingSeen === 1) {
        await record(3000);
        check(
          'speaking 1: stopping uploads, confirms and moves to the next task by itself',
          true,
        );
        await backToTask();
        check(
          'speaking 1: going back shows the task as recorded',
          (await page.locator('h2').allInnerTexts())
            .map(norm)
            .includes(norm(item.prompt)) &&
            (await page.getByRole('button', { name: /^Ghi lại$/ }).isVisible()),
        );
        const firstRow = harnessQuery(
          `select r.id, r."audioKey" from "DiagnosticSpeakingResponse" r join "DiagnosticAttempt" a on a.id = r."attemptId" join "User" u on u.id = a."userId" where u.email = '${account.email}' and r."questionId" = ${item.id}`,
        );
        await record(2000);
        await backToTask();
        const secondRow = harnessQuery(
          `select r.id, r."audioKey" from "DiagnosticSpeakingResponse" r join "DiagnosticAttempt" a on a.id = r."attemptId" join "User" u on u.id = a."userId" where u.email = '${account.email}' and r."questionId" = ${item.id}`,
        );
        const [row] = harnessQuery(
          `select r."durationMs" from "DiagnosticSpeakingResponse" r join "DiagnosticAttempt" a on a.id = r."attemptId" join "User" u on u.id = a."userId" where u.email = '${account.email}' and r."questionId" = ${item.id}`,
        );
        const client = (await reportedDurations()).at(-1);
        check(
          'speaking 1: the length the page reports is the recording itself (within 50 ms of the server-decoded length)',
          client !== undefined && Math.abs(client - Number(row?.[0])) <= 50,
          `(client ${client} ms, server ${row?.[0]} ms)`,
        );
        check(
          'speaking 1: "Ghi lại" replaces the take (one row, new audio)',
          firstRow.length === 1 &&
            secondRow.length === 1 &&
            firstRow[0][1] !== secondRow[0][1],
          `(${firstRow.length}/${secondRow.length})`,
        );
      } else {
        await record(null);
        check(
          `speaking 2: recording stopped by itself at ${item.response}s and was sent`,
          true,
        );
      }
      if (speakingSeen === 1) {
        await page.getByRole('button', { name: /^Câu tiếp/ }).click();
        await page.waitForTimeout(800);
      }
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
    if (item.section === 'READING') {
      const article = page.locator('article[aria-label="Đoạn đọc"]');
      const articleText = (await article.innerText()).replace(/\s+/g, ' ');
      const strong = await article.locator('strong').allInnerTexts();
      const expected: Record<string, string> = {
        16: 'the illusion of fluency',
        17: 'it',
        18: 'that trade-off',
      };
      const order = i + 1;
      if (order === 11)
        check(
          'reading: the passage label appears once (no duplicated heading)',
          (articleText.match(/Đoạn đọc/g) ?? []).length === 1,
        );
      if (expected[order])
        check(
          `reading ${order}: "${expected[order]}" is bolded, and only it`,
          strong.length === 1 && strong[0] === expected[order],
          `(${strong.join('|')})`,
        );
      else if (order === 12 || order === 19)
        check(
          `reading ${order}: nothing is bolded without a quoted reference`,
          strong.length === 0,
          `(${strong.join('|')})`,
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
  // FOUR_SKILL_OBSERVED_V3 (CP60-DIAG): one decimal throughout.
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const mean = (xs: number[]) => r1(xs.reduce((a, b) => a + b, 0) / xs.length);
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
  // Observed score: 35/35 objective + 7.5 per graded task, over the graded weight.
  const tasks = [...speakingScores, ...writingScores];
  const overall = r1(
    (0.35 * fs.skills.LISTENING.score +
      0.35 * fs.skills.READING.score +
      tasks.reduce((sum, t) => sum + 0.075 * t, 0)) /
      (0.7 + 0.075 * tasks.length),
  );
  check(
    'overall is the observed score (35/35 + 7.5 per graded task)',
    fs?.overall === overall && fs?.observed?.observed?.score === overall,
    `(${fs?.overall} vs ${overall})`,
  );
  check(
    'Language Use is reported with weight 0',
    fs?.skills.LANGUAGE_USE.weight === 0 &&
      fs?.skills.LANGUAGE_USE.itemsScored === (correct.LANGUAGE_USE ?? 0),
  );
  check(
    'no placement band (DEF-004 decided as D1)',
    fs?.placementBand === null &&
      fs?.placementBandStatus === 'D1_ADVISORY_SCORES_ONLY',
  );
  const [attempt] = harnessQuery(
    `select "scoringVersion", "blueprintVersion", "contentVersion", "resultState", "overallScore", (select count(*) from "DiagnosticSkillResult" s where s."attemptId" = a.id), answers->>'__resultPolicy' from "DiagnosticAttempt" a where id = ${res.data?.attemptId}`,
  );
  check(
    'the attempt pins its versions and stores the result',
    attempt?.[0] === 'FOUR_SKILL_PLACEMENT_V2' &&
      attempt?.[1] === 'V2_2026_01' &&
      attempt?.[2] === '6' &&
      attempt?.[3] === 'COMPLETE' &&
      Number(attempt?.[4]) === overall &&
      attempt?.[5] === '5' &&
      attempt?.[6] === 'FOUR_SKILL_OBSERVED_V3',
    `(${attempt?.join(' / ')})`,
  );

  await page.reload({ waitUntil: 'networkidle' });
  await settled(page);
  await hidePet(page);
  let text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'after a reload the result page shows the four-skill profile and observed score',
    text.toLowerCase().includes('hồ sơ bốn kỹ năng') &&
      text.includes('Điểm quan sát') &&
      text.includes(`${String(overall).replace('.', ',')}/100`),
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
    // The disclaimer itself says the result is not converted to CEFR.
    !/CEFR|TOEIC|IELTS|\bETS\b/.test(
      resultText.replace('không quy đổi sang trình độ CEFR', ''),
    ),
    `(${resultText.match(/.{20}(CEFR|TOEIC|IELTS|\bETS\b).{20}/)?.[0]})`,
  );
  await page.screenshot({
    path: `${EVIDENCE}/diag-v2-result-desktop.png`,
    fullPage: true,
  });
  check(
    'the result page is not left in fullscreen',
    await page.evaluate(() => document.fullscreenElement === null),
  );
  check(
    'the result page no longer shows a task total',
    !/Tổng cộng: \d+ nhiệm vụ/.test(resultText),
  );
  // Profile tab -> "Xem lại toàn bộ bài làm" -> "Quay lại" returns to the tab.
  await page.goto(`${FE}/hub?tab=diagnostic-result`, {
    waitUntil: 'networkidle',
  });
  await hidePet(page);
  await page.getByText('Điểm quan sát').first().waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: `${EVIDENCE}/diag-v2-profile-tab.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: /Xem lại toàn bộ bài làm/ }).click();
  await page.waitForURL('**/diagnostic');
  await page.getByRole('button', { name: 'Quay lại' }).first().click();
  await page.waitForURL('**/hub?tab=diagnostic-result', { timeout: 15_000 });
  check('review page has a back button that returns to the profile tab', true);
  await page.goto(`${FE}/diagnostic`, { waitUntil: 'networkidle' });
  await hidePet(page);
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

  // D1 advice: from this attempt's evidence, linking to published content.
  const advice = res.data?.advice;
  check(
    'D1 advice is returned (V1 lists are not)',
    advice?.basis === 'D1_ADVISORY_SCORES_ONLY' &&
      res.data?.practiceRecommendations?.length === 0 &&
      res.data?.recommendations?.length === 0,
  );
  const allResources = [
    ...(advice?.priorities ?? []),
    ...(advice?.supplemental ?? []),
  ].flatMap((p: any) => p.resources);
  check(
    'every cited resource has a real learner route',
    allResources.length > 0 &&
      allResources.every((r: any) =>
        /^\/(listening|reading|writing|speaking|courses)\/\d+$/.test(r.route),
      ),
    `(${allResources.map((r: any) => r.route).join(' ')})`,
  );
  check(
    'priorities are at most three and carry evidence',
    (advice?.priorities?.length ?? 0) <= 3 &&
      (advice?.priorities ?? []).every((p: any) => p.evidence && p.action),
    `(${(advice?.priorities ?? []).map((p: any) => `${p.skill}:${p.areaKey}`).join(', ')})`,
  );
  check(
    'mock-graded productive evidence is flagged to the learner',
    advice?.mockGraderEvidence === true,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await settled(page);
  await hidePet(page);
  text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the result page shows the advice with its mock-grader notice',
    text.includes('Nên luyện gì tiếp theo') &&
      text.includes('Căn cứ:') &&
      text.includes('bộ chấm thử nghiệm'),
  );
  // Open one recommended resource and come back.
  // Listening pages need private audio, which the harness does not serve,
  // so the link check uses a resource whose page does not depend on media.
  const firstOpen =
    allResources.find(
      (r: any) => r.access === 'OPEN' && r.kind !== 'LISTENING_QUIZ',
    ) ?? allResources.find((r: any) => r.access === 'OPEN');
  if (firstOpen) {
    const link = page
      .locator(
        `section[aria-labelledby="diagnostic-advice-title"] a[href="${firstOpen.route}"]`,
      )
      .first();
    // The panel shows the learner-facing title (CP60-UX-01), which is what
    // the opened page is headed by; the API title may be the stored one.
    // The second line of the card is its title; the first is the kind label.
    const shownTitle = (
      await link.locator('span.block').nth(1).innerText()
    ).trim();
    await link.click();
    await page.waitForURL((u) => u.pathname === firstOpen.route, {
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle');
    await page
      .getByText(/Đang tải dữ liệu bài luyện/)
      .first()
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => undefined);
    await page
      .getByText(shownTitle.slice(0, 12))
      .first()
      .waitFor({ timeout: 60_000 })
      .catch(() => undefined);
    const target = (await page.locator('body').innerText()).replace(
      /\s+/g,
      ' ',
    );
    // A Speaking task inside a practice set is headed by the set's title.
    const speakingId = /^\/speaking\/(\d+)$/.exec(firstOpen.route)?.[1];
    const setTitle = speakingId
      ? harnessQuery(
          `select s.title from "SpeakingExercise" e join "SpeakingPracticeSet" s on s.id = e."practiceSetId" where e.id = ${speakingId}`,
        )[0]?.[0]
      : undefined;
    check(
      `the recommended ${firstOpen.kind} opens (${firstOpen.route})`,
      !/404|Không tìm thấy|not found/i.test(target) &&
        (target.includes(firstOpen.title.slice(0, 12)) ||
          (!!shownTitle && target.includes(shownTitle.slice(0, 12))) ||
          (!!setTitle && target.includes(setTitle))),
      `(shown "${shownTitle}"; ${target.slice(0, 120)})`,
    );
    await page.goBack({ waitUntil: 'networkidle' }).catch(() => undefined);
    await settled(page);
    if (
      !(await page.locator('body').innerText()).includes(
        'Nên luyện gì tiếp theo',
      )
    ) {
      await page.goto(`${FE}/diagnostic`, { waitUntil: 'networkidle' });
      await settled(page);
    }
    check(
      'back from the resource returns to the result',
      (await page.locator('body').innerText()).includes(
        'Nên luyện gì tiếp theo',
      ),
    );
  }
  await page.screenshot({
    path: `${EVIDENCE}/diag-v2-advice-desktop.png`,
    fullPage: true,
  });
  // Another learner sees none of this attempt.
  const other = await newStudent('diag-v2-other');
  const otherResult = await call(
    'GET',
    '/diagnostic/results/latest',
    other.token,
  );
  check(
    'another learner cannot read this result',
    otherResult.data === null ||
      otherResult.data?.attemptId !== res.data.attemptId,
    `(${otherResult.status})`,
  );
  const foreignRetry = await call(
    'POST',
    `/diagnostic/5/attempts/${res.data.attemptId}/writing/${[...bank.values()].filter((q) => q.taskType === 'WRITING_RESPONSE')[0].id}/retry`,
    other.token,
  );
  check(
    "another learner cannot retry this attempt's grading",
    foreignRetry.status >= 400 && foreignRetry.status < 500,
    `(${foreignRetry.status})`,
  );

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
  await settled(page);
  await hidePet(page);
  text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the page says the overall is withheld and offers a retry per failed task',
    text.includes('Chưa có điểm tổng') &&
      text.includes('chưa chấm được') &&
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
  await settled(page);
  text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the page shows the restored overall',
    text.includes(
      `${String(res.data?.fourSkill?.overall).replace('.', ',')}/100`,
    ),
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
