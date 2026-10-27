/**
 * TOEIC post-submission result pages in real Chromium on the disposable
 * harness (deterministic writing grader + mock Speaking evaluator on :3101).
 *
 *  - L&R Full Test result: overview, Part analysis, answer list, filters and
 *    the "Đáp án chi tiết" dialog (audio span of the Listening master,
 *    authored transcript, stored explanation, prev/next, Esc) at 1920 px.
 *  - L&R selected-Part result and the full read-only review at 1366 px.
 *  - 4 Skills result: four skill cards and the Listening / Reading /
 *    Speaking / Writing tabs; private recording through a signed URL.
 *  - S&W attempt still open: pending, failed and not-submitted states.
 *  - 390 px: no page-level horizontal overflow, dialog usable.
 *  - Reading results writes nothing: no non-GET API call, no regrade, no
 *    XP / Bread / quest change; the answer key is refused before submission
 *    and to another learner.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-toeic-result-browser.ts <10s.wav>
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Page } from 'playwright';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';
// The companion pet's speech bubble is also role=dialog; result dialogs are modal.
const MODAL = '[role="dialog"][aria-modal="true"]';
const wav = readFileSync(process.argv[2]);
const WRITING_ANSWERS = [
  'A woman is putting a folder on the shelf.',
  'A worker will deliver the box this afternoon.',
  'The customer is going to pay at the counter.',
  'Passengers are checking the schedule on the board.',
  'Several people park their bicycle near the station.',
  'Hi Linh, Friday at 2 p.m. works for me. We could use meeting room B on the third floor. Should I tell the rest of the team, or will you send the new invitation?',
  'Dear Mr Davis, I am sorry that the desk lamp was missing from your order. We will send a replacement today by express delivery. Could you confirm your phone number for the courier?',
  'I believe online courses can be as effective as classroom lessons for learning English. First, learners can study at their own pace and repeat lessons as often as they need. Second, many online courses include speaking practice with teachers through video calls, so students still communicate in real time. For example, my cousin improved her speaking a lot after six months of online lessons because she could practise every evening after work. In conclusion, online courses are effective when learners are disciplined.',
];

const one = (sql: string) => harnessQuery(sql)[0][0];
const text = async (page: Page) =>
  (await page.locator('body').innerText()).replace(/\s+/g, ' ');

function balance(userId: number) {
  return [
    `select coalesce(sum(points), 0) from "PointHistory" where "userId" = ${userId}`,
    `select coalesce(max("totalBanhRan"), 0) from "UserStats" where "userId" = ${userId}`,
    `select count(*) from "BanhTransaction" where "userId" = ${userId}`,
    `select coalesce(sum("currentValue"), 0) from "UserQuestProgress" where "userId" = ${userId}`,
  ].map((sql) => Number(one(sql)));
}

/** Everything a regrade would change: submission rows and their grading fields. */
function gradingFingerprint(userId: number) {
  return one(
    `select md5(coalesce(string_agg(x, ',' order by x), '')) from (
       select 's'||id||':'||status||':'||coalesce("overallScore",-1)||':'||"attemptCount"||':'||coalesce("processedAt"::text,'') x from "SpeakingSubmission" where "userId" = ${userId}
       union all
       select 'w'||id||':'||coalesce(score,-1)||':'||md5(coalesce("aiFeedback",'')) from "Submission" where "userId" = ${userId}
     ) t`,
  );
}

const keys = (examId: number) =>
  new Map(
    harnessQuery(
      `select q."questionNumber", q.id, q."correctIndex" from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = ${examId}`,
    ).map(([n, id, key]) => [Number(n), { id: Number(id), key: Number(key) }]),
  );

async function lrAttempt(
  token: string,
  body: Record<string, unknown>,
  right: number[],
  wrong: number[],
  marked: number[],
) {
  const k = keys(1);
  const start = await call('POST', '/toeic/exams/1/attempts', token, body);
  const id = start.data.id as number;
  await call('POST', `/toeic/attempts/${id}/begin`, token, {});
  const answers: Record<number, number> = {};
  for (const n of right) answers[k.get(n)!.id] = k.get(n)!.key;
  for (const n of wrong) answers[k.get(n)!.id] = (k.get(n)!.key + 1) % 3;
  const early = await call('GET', `/toeic/attempts/${id}/review`, token);
  await call('PATCH', `/toeic/attempts/${id}/answers`, token, {
    answers,
    markedQuestionIds: marked.map((n) => k.get(n)!.id),
  });
  const submitted = await call(
    'POST',
    `/toeic/attempts/${id}/submit`,
    token,
    {},
  );
  return { id, early: early.status, submitted: submitted.status };
}

async function submitRecording(
  token: string,
  exerciseId: number,
  query: string,
) {
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
    'a.wav',
  );
  const res = await fetch(
    `${BE}/speaking/exercises/${exerciseId}/submit${query}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': randomUUID(),
      },
      body: form,
    },
  );
  const json: any = await res.json().catch(() => null);
  return {
    status: res.status,
    id: (json?.data ?? json)?.submissionId as number,
  };
}

async function waitGraded(token: string, ids: number[]) {
  for (let i = 0; i < 60; i += 1) {
    const st = await Promise.all(
      ids.map((id) => call('GET', `/speaking/submissions/${id}`, token)),
    );
    if (st.every((r) => r.data?.status === 'COMPLETED')) return true;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  return false;
}

async function main() {
  const { browser, page, account, issues } = await studentPage(
    'toeic-result',
    1920,
  );
  await hidePet(page);
  const token = account.token;

  console.log('\n== Setup over HTTP');
  // Full Test: Q1-10 and Q101-105 right, Q11 and Q106 wrong, Q12 flagged.
  const full = await lrAttempt(
    token,
    { mode: 'FULL_TEST' },
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 101, 102, 103, 104, 105],
    [11, 106],
    [12],
  );
  check(
    'the answer key is refused before submission (400)',
    full.early === 400,
    `(${full.early})`,
  );
  check('Full Test submitted', full.submitted < 300);
  // Part practice of Parts 1 and 5 (6 + 30 questions).
  const partial = await lrAttempt(
    token,
    { mode: 'PRACTICE', parts: [1, 5] },
    [1, 101],
    [2],
    [],
  );
  check('Part 1 + 5 practice submitted', partial.submitted < 300);
  const fullReview = await call(
    'GET',
    `/toeic/attempts/${full.id}/review`,
    token,
  );
  const S = fullReview.data.summary;
  check(
    'API: Full Test 15 right, 2 wrong, 183 skipped of 200',
    S.overall.correct === 15 &&
      S.overall.incorrect === 2 &&
      S.overall.skipped === 183 &&
      S.overall.total === 200,
    JSON.stringify(S.overall),
  );
  check(
    'API: Listening 10/100, Reading 5/100',
    S.listening.correct === 10 && S.reading.correct === 5,
  );
  check(
    'API: Q12 is flagged',
    fullReview.data.questions.find((q: any) => q.questionNumber === 12)
      .flagged === true,
  );
  check(
    'API: every question carries its stored explanation',
    fullReview.data.questions.every(
      (q: any) => typeof q.explanation === 'string' && q.explanation.length > 0,
    ),
  );
  check(
    'API: Parts 1-4 carry the authored transcript, Parts 5-7 none',
    fullReview.data.questions.every((q: any) =>
      q.part <= 4 ? Boolean(q.transcript) : q.transcript === null,
    ),
  );
  const partialReview = await call(
    'GET',
    `/toeic/attempts/${partial.id}/review`,
    token,
  );
  check(
    'API: part practice covers only Parts 1 and 5 (36 questions), no score',
    partialReview.data.questions.length === 36 &&
      JSON.stringify(
        partialReview.data.summary.parts.map((p: any) => p.part),
      ) === '[1,5]' &&
      partialReview.data.scores.total === null,
    `(${partialReview.data.questions.length})`,
  );
  const other = await newStudent('toeic-result-other');
  const foreign = await call(
    'GET',
    `/toeic/attempts/${full.id}/review`,
    other.token,
  );
  check(
    'another learner cannot read this review (403)',
    foreign.status === 403,
    `(${foreign.status})`,
  );
  const master = await call(
    'GET',
    `/toeic/attempts/${full.id}/listening/master`,
    token,
  );
  check(
    'Listening master stays replayable after submission',
    master.data?.available === true,
    JSON.stringify(master.data).slice(0, 80),
  );

  // 4 Skills: L&R child + 11 recordings + 8 writing answers.
  const fs = await call('POST', '/toeic/assessments/2/attempts', token, {
    idempotencyKey: randomUUID(),
  });
  const fsId = fs.data.id as number;
  const comp = (data: any, kind: string) =>
    data.components.find((c: any) => c.kind === kind);
  const step = (attemptId: number, c: any, action: string) =>
    `/toeic/assessments/attempts/${attemptId}/components/${c.assessmentComponentId}/${action}`;
  const lrStart = await call(
    'POST',
    step(fsId, comp(fs.data, 'LISTENING_READING'), 'start'),
    token,
  );
  const childId = comp(lrStart.data, 'LISTENING_READING')
    .childAttemptId as number;
  await call('POST', `/toeic/attempts/${childId}/begin`, token, {});
  const k = keys(1);
  await call('PATCH', `/toeic/attempts/${childId}/answers`, token, {
    answers: Object.fromEntries(
      [1, 2, 3, 150, 151].map((n) => [k.get(n)!.id, k.get(n)!.key]),
    ),
  });
  await call('POST', `/toeic/attempts/${childId}/submit`, token, {});
  await call(
    'POST',
    step(fsId, comp(fs.data, 'LISTENING_READING'), 'complete'),
    token,
    {},
  );
  const sp = comp(fs.data, 'SPEAKING');
  await call('POST', step(fsId, sp, 'start'), token);
  const spIds: number[] = [];
  for (const exerciseId of sp.speakingExerciseIds as number[]) {
    const r = await submitRecording(
      token,
      exerciseId,
      `?parentAttemptId=${fsId}&parentComponentId=${sp.assessmentComponentId}`,
    );
    if (r.status < 300) spIds.push(r.id);
  }
  check(
    '4 Skills: 11 recordings accepted',
    spIds.length === 11,
    `(${spIds.length})`,
  );
  check(
    '4 Skills: recordings graded by the mock evaluator',
    await waitGraded(token, spIds),
  );
  await call('POST', step(fsId, sp, 'complete'), token, {
    speakingSubmissionIds: spIds,
  });
  const wr = comp(fs.data, 'WRITING');
  await call('POST', step(fsId, wr, 'start'), token);
  for (const [i, quizId] of (wr.writingQuizIds as number[]).entries())
    await call(
      'POST',
      `/writing/quizzes/${quizId}/submit?parentAttemptId=${fsId}&parentComponentId=${wr.assessmentComponentId}`,
      token,
      {
        answer: WRITING_ANSWERS[i],
        clientAttemptId: randomUUID(),
      },
    );
  await call('POST', step(fsId, wr, 'complete'), token, {});
  const fsReview = await call(
    'GET',
    `/toeic/assessments/attempts/${fsId}/review`,
    token,
  );
  const fsSp = comp(fsReview.data, 'SPEAKING');
  const fsWr = comp(fsReview.data, 'WRITING');
  check(
    '4 Skills attempt COMPLETED',
    fsReview.data.status === 'COMPLETED',
    fsReview.data.status,
  );
  check(
    'review API: 11 Speaking tasks graded, 8 Writing tasks graded',
    fsSp.tasks.length === 11 &&
      fsSp.tasks.every((t: any) => t.status === 'GRADED') &&
      fsWr.tasks.length === 8 &&
      fsWr.tasks.every((t: any) => t.status === 'GRADED'),
  );
  check(
    'review API: child L&R link is the submitted child attempt',
    comp(fsReview.data, 'LISTENING_READING').childAttemptId === childId &&
      comp(fsReview.data, 'LISTENING_READING').childStatus === 'SUBMITTED',
  );
  check(
    'review API exposes no recording URL or storage key',
    !/premium\/speaking|X-Amz/.test(JSON.stringify(fsReview.data)),
  );
  const foreignAssess = await call(
    'GET',
    `/toeic/assessments/attempts/${fsId}/review`,
    other.token,
  );
  check(
    'another learner cannot read the 4 Skills review (403)',
    foreignAssess.status === 403,
    `(${foreignAssess.status})`,
  );

  // S&W left open: one graded, one failed, one still processing, rest not done.
  const sw = await call('POST', '/toeic/assessments/1/attempts', token, {
    idempotencyKey: randomUUID(),
  });
  const swId = sw.data.id as number;
  const swSp = comp(sw.data, 'SPEAKING');
  await call('POST', step(swId, swSp, 'start'), token);
  const swIds: number[] = [];
  for (const exerciseId of (swSp.speakingExerciseIds as number[]).slice(0, 3)) {
    const r = await submitRecording(
      token,
      exerciseId,
      `?parentAttemptId=${swId}&parentComponentId=${swSp.assessmentComponentId}`,
    );
    if (r.status < 300) swIds.push(r.id);
  }
  await waitGraded(token, swIds);
  harnessExec(
    `update "SpeakingSubmission" set status = 'FAILED', "overallScore" = null where id = ${swIds[1]}`,
  );
  harnessExec(
    `update "SpeakingSubmission" set status = 'PROCESSING', "overallScore" = null, "processingStartedAt" = now() where id = ${swIds[2]}`,
  );
  const swReview = await call(
    'GET',
    `/toeic/assessments/attempts/${swId}/review`,
    token,
  );
  check(
    'review API: S&W states GRADED, FAILED, PENDING, then NOT_SUBMITTED',
    JSON.stringify(
      comp(swReview.data, 'SPEAKING')
        .tasks.slice(0, 4)
        .map((t: any) => t.status),
    ) === '["GRADED","FAILED","PENDING","NOT_SUBMITTED"]',
    JSON.stringify(
      comp(swReview.data, 'SPEAKING')
        .tasks.slice(0, 4)
        .map((t: any) => t.status),
    ),
  );

  // From here on the learner only reads.
  const before = balance(account.userId);
  const gradingBefore = gradingFingerprint(account.userId);
  const writes: string[] = [];
  page.on('request', (r) => {
    if (
      r.url().startsWith(BE) &&
      r.method() !== 'GET' &&
      !r.url().includes('/auth/refresh')
    )
      writes.push(`${r.method()} ${r.url().slice(BE.length)}`);
  });

  console.log('\n== L&R Full Test result, 1920 px');
  await page.goto(`${FE}/toeic/results/${full.id}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page
    .getByRole('heading', { name: /Kết quả thi:/ })
    .waitFor({ timeout: 60_000 });
  let body = await text(page);
  check(
    'header "Kết quả thi: <exam>" with Full Test scope',
    /Kết quả thi: .+/.test(body) && body.includes('Full Test'),
  );
  check(
    'header actions "Xem đáp án" and "Về trang đề thi"',
    (await page.getByRole('link', { name: 'Xem đáp án' }).count()) === 1 &&
      (await page.getByRole('link', { name: 'Về trang đề thi' }).count()) === 1,
  );
  check(
    'overview: 15/200, accuracy 7.5%',
    body.includes('Kết quả làm bài 15/200') &&
      body.includes('Độ chính xác 7.5%'),
  );
  check(
    'overview: right 15, wrong 2, skipped 183',
    body.includes('Trả lời đúng 15') &&
      body.includes('Trả lời sai 2') &&
      body.includes('Bỏ qua 183'),
  );
  check(
    'internal score labelled, matching the API, not presented as ETS',
    body.includes(
      `Điểm luyện L&R (BreadTrans) ${fullReview.data.scores.total}`,
    ) && body.includes('không phải điểm thi ETS'),
  );
  check(
    'Listening and Reading cards 10/100 and 5/100',
    body.includes('Listening 10/100 câu đúng') &&
      body.includes('Reading 5/100 câu đúng'),
  );
  const partTabs = page
    .getByRole('tablist', { name: 'Chọn Part' })
    .getByRole('tab');
  check('analysis tabs: Tổng quát + Part 1-7', (await partTabs.count()) === 8);
  check(
    'Tổng quát markers cover all 200 questions',
    (await page.locator('table button[aria-label^="Câu "]').count()) === 200,
  );
  check(
    'no inferred question-type labels on the result page',
    !body.includes('Câu hỏi When') && body.includes('không chia theo dạng câu'),
  );
  await page.getByRole('tab', { name: 'Part 1' }).click();
  body = await text(page);
  check(
    'Part 1 tab: one row, 6 markers',
    (await page.locator('table tbody tr').count()) === 1 &&
      (await page.locator('table button[aria-label^="Câu "]').count()) === 6,
  );
  await page.getByRole('tab', { name: 'Tổng quát' }).click();
  await page.screenshot({
    path: `${SHOTS}/toeic-result-lr-1920.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: /^Sai \(2\)$/ }).click();
  check(
    'filter "Sai": rows 11 and 106 only',
    JSON.stringify(
      await page
        .locator('[data-review-row]')
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-review-row')),
        ),
    ) === '["11","106"]',
  );
  await page.getByRole('button', { name: /^Đã đánh dấu \(1\)$/ }).click();
  check(
    'filter "Đã đánh dấu": row 12 only',
    JSON.stringify(
      await page
        .locator('[data-review-row]')
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-review-row')),
        ),
    ) === '["12"]',
  );
  await page.getByRole('button', { name: /^Bỏ qua \(183\)$/ }).click();
  check(
    'filter "Bỏ qua": 183 rows',
    (await page.locator('[data-review-row]').count()) === 183,
  );
  await page.getByRole('button', { name: /^Tất cả \(200\)$/ }).click();

  const marker = page.getByRole('button', {
    name: 'Câu 11, sai. Xem chi tiết',
  });
  await marker.click();
  const dialog = page.getByRole('dialog', { name: 'Đáp án chi tiết #11' });
  await dialog.waitFor({ timeout: 10_000 });
  const q11 = fullReview.data.questions.find(
    (q: any) => q.questionNumber === 11,
  );
  body = (await dialog.innerText()).replace(/\s+/g, ' ');
  check(
    'dialog "Đáp án chi tiết #11" shows exam and Part 2',
    body.includes('Part 2'),
  );
  check(
    'dialog marks the chosen wrong option and the correct one',
    body.includes('Bạn chọn') && body.includes('Đáp án đúng'),
  );
  check(
    'dialog shows the stored explanation',
    body.includes(q11.explanation.slice(0, 40)),
  );
  check(
    'close button has focus when the dialog opens',
    await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === 'Đóng',
    ),
  );
  const audio = dialog.locator('audio[data-testid="review-group-audio"]');
  check(
    'dialog audio is the Listening master',
    ((await audio.getAttribute('src')) ?? '').includes('listening-master'),
  );
  await dialog.getByRole('button', { name: 'Nghe audio đoạn này' }).click();
  await page.waitForTimeout(2500);
  const seg = master.data.timeline.find(
    (s: any) => s.kind === 'GROUP' && s.groupId === q11.groupId,
  );
  const t = await audio.evaluate((el: HTMLAudioElement) => el.currentTime);
  check(
    'audio plays inside the group span of Q11',
    t > seg.start && t < seg.end,
    `(t=${t.toFixed(1)} span ${seg.start.toFixed(1)}-${seg.end.toFixed(1)})`,
  );
  await dialog.getByRole('button', { name: 'Hiện Transcript' }).click();
  check(
    '"Hiện Transcript" shows the authored script',
    (await dialog.innerText()).includes(
      q11.transcript.split('\n')[0].slice(0, 30),
    ),
  );
  await page.screenshot({ path: `${SHOTS}/toeic-result-dialog-1920.png` });
  await dialog.getByRole('button', { name: /Câu tiếp theo/ }).click();
  check(
    '"Câu tiếp theo" opens #12',
    (await page
      .getByRole('dialog', { name: 'Đáp án chi tiết #12' })
      .count()) === 1,
  );
  await page
    .locator(MODAL)
    .getByRole('button', { name: /Câu trước/ })
    .click();
  check(
    '"Câu trước" returns to #11',
    (await page
      .getByRole('dialog', { name: 'Đáp án chi tiết #11' })
      .count()) === 1,
  );
  await page.keyboard.press('Escape');
  check('Esc closes the dialog', (await page.locator(MODAL).count()) === 0);
  check(
    'focus returns to the marker',
    await page.evaluate(
      () =>
        document.activeElement?.getAttribute('aria-label') ===
        'Câu 11, sai. Xem chi tiết',
    ),
  );
  const q101 = page.getByRole('button', {
    name: 'Câu 101, đúng. Xem chi tiết',
  });
  await q101.click();
  body = (await page.locator(MODAL).innerText()).replace(/\s+/g, ' ');
  check(
    'Part 5 dialog: no audio player, question text shown',
    (await page.locator(MODAL).locator('audio').count()) === 0 &&
      body.includes(
        fullReview.data.questions
          .find((q: any) => q.questionNumber === 101)
          .questionText.slice(0, 20),
      ),
  );
  await page.keyboard.press('Escape');

  console.log('\n== Selected-Part result and full review, 1366 px');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${FE}/toeic/results/${partial.id}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page
    .getByRole('heading', { name: /Kết quả thi:/ })
    .waitFor({ timeout: 60_000 });
  body = await text(page);
  check(
    'scope chip "Luyện tập Part 1, 5"',
    body.includes('Luyện tập Part 1, 5'),
  );
  check(
    'part practice: 2/36, no converted score',
    body.includes('Kết quả làm bài 2/36') &&
      body.includes('không quy đổi điểm') &&
      !body.includes('Điểm luyện L&R'),
  );
  check(
    'analysis tabs: Tổng quát, Part 1, Part 5',
    (await partTabs.count()) === 3,
  );
  await page.screenshot({
    path: `${SHOTS}/toeic-result-partial-1366.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Xem chi tiết đáp án' }).click();
  await page.waitForURL(/\/toeic\/review\//, { timeout: 60_000 });
  await page
    .getByRole('heading', { name: /Chi tiết đáp án/ })
    .waitFor({ timeout: 60_000 });
  check(
    'full review lists all 36 questions',
    (await page.locator('article[id^="q-"]').count()) === 36,
  );
  check(
    'full review groups Parts 1 and 5',
    (await page
      .getByRole('heading', { level: 2, name: /^Part 1|^Part 5/ })
      .count()) === 2,
  );
  await page.screenshot({ path: `${SHOTS}/toeic-review-partial-1366.png` });

  console.log('\n== 4 Skills result');
  await page.goto(`${FE}/toeic/assessments/2/attempts/${fsId}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.getByRole('link', { name: 'Xem kết quả chi tiết' }).click();
  await page.waitForURL(/\/result$/, { timeout: 60_000 });
  await page
    .getByRole('heading', { name: /Kết quả thi:/ })
    .waitFor({ timeout: 60_000 });
  const skillTabs = page
    .getByRole('tablist', { name: 'Kỹ năng' })
    .getByRole('tab');
  check(
    'tabs Tổng quan / Listening / Reading / Speaking / Writing',
    JSON.stringify(await skillTabs.allInnerTexts()) ===
      '["Tổng quan","Listening","Reading","Speaking","Writing"]',
  );
  body = await text(page);
  const skills = fsReview.data.skills;
  const lrS = skills.find((s: any) => s.kind === 'LISTENING_READING');
  const spS = skills.find((s: any) => s.kind === 'SPEAKING');
  const wrS = skills.find((s: any) => s.kind === 'WRITING');
  check(
    'four skill cards show the stored scores',
    body.includes(`Listening ${lrS.listeningScore}`) &&
      body.includes(`Reading ${lrS.readingScore}`) &&
      body.includes(`Speaking ${spS.meanScore}/10`) &&
      body.includes(`Writing ${wrS.points}/${wrS.maxPoints}`),
  );
  check(
    'no combined score and no ETS claim',
    body.includes('không gộp thành một điểm tổng') && !/Tổng điểm/.test(body),
  );
  await page.screenshot({
    path: `${SHOTS}/toeic-result-4s-overview-1366.png`,
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Listening' }).click();
  await page
    .getByRole('tablist', { name: 'Chọn Part' })
    .waitFor({ timeout: 60_000 });
  check(
    'Listening tab: Tổng quát + Part 1-4 of the child attempt',
    (await partTabs.count()) === 5,
  );
  body = await text(page);
  check('Listening tab: 3/100', body.includes('Kết quả làm bài 3/100'));
  await page.getByRole('tab', { name: 'Reading' }).click();
  await page.waitForTimeout(500);
  check('Reading tab: Tổng quát + Part 5-7', (await partTabs.count()) === 4);
  await page.getByRole('tab', { name: 'Speaking' }).click();
  check(
    'Speaking tab: 11 tasks',
    (await page.locator('[data-speaking-task]').count()) === 11,
  );
  body = await text(page);
  check(
    'Speaking groups Q1–2, Q3–4, Q5–7, Q8–10, Q11',
    ['Q1–2', 'Q3–4', 'Q5–7', 'Q8–10', 'Q11 '].every((g) => body.includes(g)),
  );
  await page
    .locator('[data-speaking-task="1"]')
    .getByRole('button', { name: '[Chi tiết]' })
    .click();
  const spDialog = page.getByRole('dialog', { name: 'Speaking · Câu 1' });
  await spDialog.waitFor({ timeout: 10_000 });
  body = (await spDialog.innerText()).replace(/\s+/g, ' ');
  check(
    'Speaking detail: prompt, transcript, score and criteria',
    body.includes('Đề bài') &&
      body.includes(String(fsSp.tasks[0].submission.transcript).slice(0, 40)) &&
      body.includes('Điểm luyện Speaking (BreadTrans)') &&
      body.includes('Độ chính xác'),
  );
  await spDialog.getByRole('button', { name: 'Nghe bản ghi của bạn' }).click();
  const rec = spDialog.locator('audio[data-testid="speaking-recording"]');
  await rec.waitFor({ timeout: 15_000 });
  const recSrc = (await rec.getAttribute('src')) ?? '';
  check(
    'recording plays from a short-lived signed URL of the private bucket',
    recSrc.includes('harness-private') &&
      /X-Amz-(Signature|Expires)/.test(recSrc),
    recSrc.replace(/X-Amz-Signature=[^&]+/, 'X-Amz-Signature=…').slice(0, 90),
  );
  await page.screenshot({ path: `${SHOTS}/toeic-result-4s-speaking-1366.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Writing' }).click();
  check(
    'Writing tab: 8 tasks',
    (await page.locator('[data-writing-task]').count()) === 8,
  );
  body = await text(page);
  check(
    'Writing groups Q1–5, Q6–7, Q8',
    ['Q1–5', 'Q6–7', 'Q8 '].every((g) => body.includes(g)),
  );
  check(
    'Writing task 8 scored on its own scale (x/5)',
    /Câu 8 .+ \d\/5 Đã chấm/.test(body),
  );
  await page.screenshot({
    path: `${SHOTS}/toeic-result-4s-writing-1366.png`,
    fullPage: true,
  });
  await page
    .locator('[data-writing-task="8"]')
    .getByRole('link', { name: '[Chi tiết]' })
    .click();
  await page.waitForURL(/\/writing\/submissions\/\d+/, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  body = await text(page);
  check(
    'Writing detail opens with the learner text',
    body.includes('online courses can be as effective'),
  );

  console.log('\n== S&W result with open tasks');
  await page.goto(`${FE}/toeic/assessments/1/attempts/${swId}/result`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page
    .getByRole('heading', { name: /Kết quả thi:/ })
    .waitFor({ timeout: 60_000 });
  body = await text(page);
  check(
    'S&W: tabs Tổng quan / Speaking / Writing',
    JSON.stringify(await skillTabs.allInnerTexts()) ===
      '["Tổng quan","Speaking","Writing"]',
  );
  check(
    'S&W overview: "Chưa hoàn thành", 1 đang chấm, 1 chấm lỗi, 8 chưa làm',
    body.includes('Chưa hoàn thành') &&
      body.includes('1 câu đang chấm · 1 câu chấm lỗi · 8 câu chưa làm'),
  );
  await page.getByRole('tab', { name: 'Speaking' }).click();
  body = await text(page);
  check(
    'S&W Speaking rows: Đã chấm, Chấm lỗi, Đang chấm, Chưa làm',
    ['Đã chấm', 'Chấm lỗi', 'Đang chấm', 'Chưa làm'].every((s) =>
      body.includes(s),
    ),
  );
  await page
    .locator('[data-speaking-task="2"]')
    .getByRole('button', { name: '[Chi tiết]' })
    .click();
  check(
    'failed task explains that the page does not regrade',
    (await page.locator(MODAL).innerText()).includes('không tự chấm lại'),
  );
  await page.screenshot({ path: `${SHOTS}/toeic-result-sw-pending-1366.png` });
  await page.keyboard.press('Escape');

  console.log('\n== 390 px');
  await page.setViewportSize({ width: 390, height: 860 });
  for (const url of [
    `/toeic/results/${full.id}`,
    `/toeic/assessments/2/attempts/${fsId}/result`,
    `/toeic/review/${partial.id}`,
  ]) {
    await page.goto(`${FE}${url}`, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    check(
      `no horizontal overflow at 390 px: ${url.replace(/\d+/g, ':id')}`,
      overflow <= 1,
      `(${overflow}px)`,
    );
  }
  await page.goto(`${FE}/toeic/results/${full.id}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.screenshot({
    path: `${SHOTS}/toeic-result-lr-390.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Câu 11, sai. Xem chi tiết' }).click();
  const box = await page.locator(MODAL).boundingBox();
  check(
    'dialog fits the 390 px viewport',
    Boolean(box && box.width <= 390 && box.x >= 0),
  );
  await page.screenshot({ path: `${SHOTS}/toeic-result-dialog-390.png` });
  await page.keyboard.press('Escape');

  await new Promise((ok) => setTimeout(ok, 2000));
  const delta = balance(account.userId).map((v, i) => v - before[i]);
  check(
    'reading results: XP 0, Bread 0, ledger 0, quests 0',
    delta.every((v) => v === 0),
    `(${delta.join(',')})`,
  );
  check(
    'reading results regraded nothing (submissions unchanged)',
    gradingFingerprint(account.userId) === gradingBefore,
  );
  check(
    'result pages sent no write request',
    writes.length === 0,
    writes.join(' | '),
  );
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api')).join(' | '),
  );
  check(
    'no page error',
    !issues.some((x) => x.startsWith('pageerror')),
    issues.filter((x) => x.startsWith('pageerror')).join(' | '),
  );
  await browser.close();
  console.log(`\nTOEIC_RESULT_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
