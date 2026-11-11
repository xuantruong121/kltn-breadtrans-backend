/**
 * Guided rewrite of a graded Writing practice answer, on the disposable
 * harness (owner 2026-11-11). The harness grader is deterministic: it reports
 * a correction when the text has "<word> ask", and for a revision its feedback
 * says how many earlier corrections it was given.
 *
 * API: a graded practice answer can be revised twice and not a third time; an
 * unchanged text and another learner are refused; a revision is stored on the
 * first submission, compared with the text before it, and pays no XP and no
 * Bánh Mì; a replayed request returns the same revision.
 * Browser: the result page offers "Sửa và nộp lại", the revision page shows
 * the before/after comparison, at 1366 and 390 px.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-writing-revision.ts
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newStudent } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const QUIZ = 17; // Writing A2, five tasks, FREE
const FIRST =
  'Hi Lan, thanks for your message. My sister ask me to meet you on Saturday at ten near the library. I will bring the notes and we can study together. See you, Minh';
const FIXED = FIRST.replace('sister ask', 'sister asks');
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
const settle = () => new Promise((ok) => setTimeout(ok, 2500));
const task = Number(
  one(
    `select id from "Question" where "quizId" = ${QUIZ} order by "order", id limit 1`,
  ),
);

type Learner = Awaited<ReturnType<typeof newStudent>>;
const paid = (u: Learner) =>
  [
    one(
      `select coalesce(sum(points),0) from "PointHistory" where "userId" = ${u.userId}`,
    ),
    one(
      `select coalesce(sum(amount),0) from "BanhTransaction" where "userId" = ${u.userId}`,
    ),
    one(`select count(*) from "UserQuizReward" where "userId" = ${u.userId}`),
  ].join('/');

const submit = (u: Learner, text: string) =>
  call('POST', `/writing/quizzes/${QUIZ}/submit`, u.token, {
    answer: text,
    questionId: task,
    clientAttemptId: randomUUID(),
  });
const revise = (u: Learner, id: number, text: string, key = randomUUID()) =>
  call('POST', `/writing/submissions/${id}/revise`, u.token, {
    answer: text,
    clientAttemptId: key,
  });
const view = async (u: Learner, id: number) =>
  (await call('GET', `/quizzes/submissions/${id}/analytics`, u.token)).data
    ?.writingRevision;

async function api() {
  const a = await newStudent('rev-a');
  const b = await newStudent('rev-b');

  const first = await submit(a, FIRST);
  const s1 = Number(first.data?.submissionId);
  check(
    'the first answer is graded with one correction',
    first.status < 300 && first.data?.corrections?.length === 1,
    JSON.stringify(first.data?.corrections),
  );
  let v = await view(a, s1);
  check(
    'a graded practice answer can be revised: 2 left',
    v?.number === 0 && v?.remaining === 2 && v?.canRevise === true,
    JSON.stringify(v),
  );

  let res = await revise(a, s1, `  ${FIRST.toUpperCase()} `);
  check(
    'an unchanged text is refused (400)',
    res.status === 400,
    String(res.status),
  );
  res = await revise(b, s1, FIXED);
  check(
    "another learner's answer is not found (404)",
    res.status === 404,
    String(res.status),
  );
  res = await call(
    'POST',
    `/writing/submissions/${s1}/revise`,
    undefined as any,
    {
      answer: FIXED,
    },
  );
  check(
    'a signed-out request is refused (401)',
    res.status === 401,
    String(res.status),
  );

  await settle();
  const before = paid(a);
  const key = randomUUID();
  res = await revise(a, s1, FIXED, key);
  const s2 = Number(res.data?.submissionId);
  check(
    'revision 1 is graded and stored on the first submission',
    res.status < 300 &&
      s2 > s1 &&
      one(`select "revisionOfId" from "Submission" where id = ${s2}`) ===
        String(s1),
    `${res.status} ${JSON.stringify(res.data?.revision ?? res.message)}`.slice(
      0,
      200,
    ),
  );
  check(
    'the grader received the earlier correction',
    String(res.data?.feedback).includes('đã nhận 1 lỗi của lần trước'),
    String(res.data?.feedback),
  );
  const cmp = res.data?.revision?.comparison;
  check(
    'the comparison shows the earlier mistake as fixed',
    res.data?.revision?.number === 1 &&
      res.data?.revision?.remaining === 1 &&
      cmp?.previousSubmissionId === s1 &&
      cmp?.fixed?.length === 1 &&
      cmp?.remaining?.length === 0 &&
      cmp?.criteria?.length > 0,
    JSON.stringify(cmp)?.slice(0, 200),
  );
  const replay = await revise(a, s1, FIXED, key);
  check(
    'a replayed request returns the same revision',
    Number(replay.data?.submissionId) === s2 &&
      one(`select count(*) from "Submission" where "revisionOfId" = ${s1}`) ===
        '1',
    String(replay.data?.submissionId),
  );
  await settle();
  check(
    'a revision pays no XP and no Bánh Mì',
    paid(a) === before,
    `${before} -> ${paid(a)}`,
  );

  v = await view(a, s1);
  check(
    'the first text is no longer the latest and cannot be revised itself',
    v?.isLatest === false && v?.canRevise === false && v?.chain?.length === 2,
    JSON.stringify(v)?.slice(0, 160),
  );

  // A text that still has the mistake: the comparison is with revision 1.
  res = await revise(a, s2, `${FIXED} My brother ask too.`);
  const s3 = Number(res.data?.submissionId);
  check(
    'revision 2 is compared with revision 1',
    res.status < 300 &&
      res.data?.revision?.number === 2 &&
      res.data?.revision?.remaining === 0 &&
      res.data?.revision?.comparison?.previousSubmissionId === s2,
    `${res.status} ${JSON.stringify(res.data?.revision)?.slice(0, 160)}`,
  );
  res = await revise(a, s3, `${FIXED} One more sentence.`);
  check(
    'a third revision is refused (409)',
    res.status === 409,
    String(res.status),
  );
  res = await revise(a, s1, `${FIXED} From the first text.`);
  check(
    'and so is one sent from the first text (409)',
    res.status === 409 &&
      one(`select count(*) from "Submission" where "revisionOfId" = ${s1}`) ===
        '2',
    String(res.status),
  );
  await settle();
  check(
    'two revisions paid nothing',
    paid(a) === before,
    `${before} -> ${paid(a)}`,
  );

  // A finished exercise has paid its reward once; a revision adds nothing.
  const d = await newStudent('rev-d');
  const tasks = harnessQuery(
    `select id from "Question" where "quizId" = ${QUIZ} order by "order", id`,
  ).map((r) => Number(r[0]));
  let d1 = 0;
  for (const questionId of tasks) {
    const r = await call('POST', `/writing/quizzes/${QUIZ}/submit`, d.token, {
      answer: `${FIRST} [[percent:60]]`,
      questionId,
      clientAttemptId: randomUUID(),
    });
    if (!d1) d1 = Number(r.data?.submissionId);
  }
  await settle();
  const rewarded = paid(d);
  const better = await revise(d, d1, `${FIXED} [[percent:100]]`);
  await settle();
  check(
    'after the exercise reward, a better revision pays nothing more',
    better.status < 300 &&
      better.data?.revision?.comparison?.scoreAfter >
        better.data?.revision?.comparison?.scoreBefore &&
      !rewarded.startsWith('0/0/') &&
      paid(d) === rewarded,
    `${rewarded} -> ${paid(d)} (${better.status})`,
  );

  // Two requests at once for the last revision: one is stored.
  const c = await newStudent('rev-c');
  const c1 = Number((await submit(c, FIRST)).data?.submissionId);
  await revise(c, c1, FIXED);
  const race = await Promise.all([
    revise(c, c1, `${FIXED} First.`),
    revise(c, c1, `${FIXED} Second.`),
  ]);
  check(
    'two requests at once take one revision, not two',
    one(`select count(*) from "Submission" where "revisionOfId" = ${c1}`) ===
      '2' &&
      race.filter((r) => r.status < 300).length === 1 &&
      race.filter((r) => r.status === 409).length === 1,
    race.map((r) => r.status).join(','),
  );
}

async function browserFlow() {
  const { browser, page, account, issues } = await studentPage('rev-ui');
  const first = await submit(account, FIRST);
  const s1 = Number(first.data?.submissionId);

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${FE}/writing/submissions/${s1}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const open = page.getByRole('button', { name: 'Sửa và nộp lại' });
  await open.waitFor({ timeout: 60_000 });
  check(
    'the result page says how many revisions are left',
    (await page.getByText('Còn 2/2 lần sửa').count()) === 1,
  );
  await open.click();
  const box = page.getByLabel('Sửa trực tiếp trên bài của bạn', {
    exact: false,
  });
  const send = page.getByRole('button', { name: 'Nộp bản sửa' });
  check(
    'the editor holds the submitted text and cannot send it unchanged',
    (await box.inputValue()) === FIRST && (await send.isDisabled()),
  );
  await box.fill(FIXED);
  await page.screenshot({
    path: `${SHOTS}/writing-revision-editor.png`,
    fullPage: true,
  });
  await send.click();
  await page
    .getByRole('heading', { name: 'So với bản gốc' })
    .waitFor({ timeout: 60_000 });
  const s2 = Number(page.url().split('/').pop());
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the revision opens on its own page with the comparison',
    s2 > s1 &&
      text.includes('Bản sửa 1') &&
      text.includes('Lỗi đã sửa (1)') &&
      text.includes('Lỗi còn lại (0)') &&
      text.includes('Bỏ 1 từ, thêm 1 từ.'),
    text.slice(0, 200),
  );
  check(
    'the changed word is marked as removed and added',
    (await page.locator('del', { hasText: 'ask' }).count()) === 1 &&
      (await page.locator('ins', { hasText: 'asks' }).count()) === 1,
  );
  check('one revision is left', text.includes('Còn 1/2 lần sửa'));
  await page.screenshot({
    path: `${SHOTS}/writing-revision-compare-1366.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check('no sideways scroll at 390 px', overflow <= 0, `overflow ${overflow}`);
  await page.screenshot({
    path: `${SHOTS}/writing-revision-compare-390.png`,
    fullPage: true,
  });

  await page.getByRole('link', { name: /Bản gốc/ }).click();
  await page
    .getByText('Đây không phải bản mới nhất.')
    .waitFor({ timeout: 60_000 });
  check(
    'the first text links to the latest one and offers no revision',
    (await page.getByRole('button', { name: 'Sửa và nộp lại' }).count()) === 0,
  );

  check(
    'no console or network errors',
    issues.length === 0,
    issues.slice(0, 3).join(' | '),
  );
  await browser.close();
}

void (async () => {
  await api();
  await browserFlow();
  console.log(`\nFAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
