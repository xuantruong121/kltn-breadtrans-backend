/**
 * Mistake notebook ("Sổ lỗi") on the disposable harness (owner 2026-11-11).
 *
 * API: wrong answers of grammar and reading (not of a TOEIC exam) and the
 * corrections of a graded Writing answer are read into the notebook when it
 * is opened; an attempt in progress is not; each attempt is read once; a
 * review question carries no key; two right answers in a row close a
 * mistake, in a review or in a later attempt; a wrong one reopens the count;
 * another learner cannot touch a mistake; the tutor is told the top tags.
 * Browser: dashboard card, account menu entry, the notebook page with its
 * filters, a review, the old /reading/mistakes address; 1366 and 390 px.
 *
 * NOT_RUN here: speaking words (the harness has no pronunciation grading);
 * mistakes.spec.ts covers that extractor.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-mistake-notebook.ts
 */
import { randomUUID } from 'node:crypto';

import {
  call,
  check,
  failureCount,
  newStudent,
  onboard,
  unlockAllLevels,
} from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
type Learner = Awaited<ReturnType<typeof newStudent>>;

const summary = async (u: Learner) =>
  (await call('GET', '/mistakes/summary', u.token)).data;
const list = async (u: Learner, query = '') =>
  (await call('GET', `/mistakes${query}`, u.token)).data;

/** A published grammar topic and its questions with their keys. */
function grammarTopic() {
  const topicId = Number(
    one(
      `select t.id from "GrammarTopic" t where t."publicationStatus" = 'PUBLISHED' and (select count(*) from "GrammarQuestion" g where g."topicId" = t.id) >= 2 order by t.id limit 1`,
    ),
  );
  const questions = harnessQuery(
    `select id, "correctIndex" from "GrammarQuestion" where "topicId" = ${topicId} order by "order", id`,
  ).map(([id, correct]) => ({ id: Number(id), correct: Number(correct) }));
  return { topicId, questions };
}

/** Submits the topic with the first `wrong` questions answered wrong. */
async function grammarAttempt(u: Learner, wrong: number) {
  const { topicId, questions } = grammarTopic();
  return call('POST', `/grammar/topics/${topicId}/attempt`, u.token, {
    answers: Object.fromEntries(
      questions.map((q, i) => [
        String(q.id),
        i < wrong ? (q.correct + 1) % 4 : q.correct,
      ]),
    ),
  });
}

/** Submits the first reading quiz; the first question wrong when asked. */
async function readingAttempt(u: Learner, firstWrong: boolean) {
  const quizId = Number(
    one(
      `select q.id from "Quiz" q where q.type = 'BILINGUAL_READING' and q."publicationStatus" = 'PUBLISHED' and exists (select 1 from "Question" x where x."quizId" = q.id) order by q.id limit 1`,
    ),
  );
  const keys = harnessQuery(
    `select id, content::text from "Question" where "quizId" = ${quizId} order by "order", id`,
  ).map(([id, content]) => ({ id: Number(id), content: JSON.parse(content) }));
  const res = await call('POST', `/quizzes/${quizId}/submit`, u.token, {
    answers: keys.map((k, i) => {
      const c = k.content;
      const index =
        firstWrong && i === 0
          ? (c.correctIndex + 1) % c.options.length
          : c.correctIndex;
      return { questionId: k.id, answer: c.options[index] };
    }),
    clientAttemptId: randomUUID(),
  });
  return { res, firstQuestionId: keys[0].id };
}

async function api() {
  const a = await newStudent('mis-a');
  const b = await newStudent('mis-b');
  await onboard(a.token);
  unlockAllLevels(a.userId);

  let s = await summary(a);
  check(
    'a new learner has an empty notebook',
    s?.open === 0,
    JSON.stringify(s),
  );

  // Grammar: one wrong answer.
  const g = await grammarAttempt(a, 1);
  s = await summary(a);
  check(
    'a wrong grammar answer is in the notebook',
    g.status < 300 &&
      s?.open === 1 &&
      s?.bySkill?.GRAMMAR === 1 &&
      s?.answerable === 1,
    JSON.stringify(s),
  );
  let items = (await list(a, '?skill=grammar')).items;
  const mistake = items[0];
  check(
    'the notebook shows the question, the choice made, the key and the topic',
    mistake?.detail?.kind === 'CHOICE' &&
      typeof mistake.detail.correctIndex === 'number' &&
      mistake.detail.selectedIndex !== mistake.detail.correctIndex &&
      !!mistake.tag &&
      mistake.wrongCount === 1,
    JSON.stringify(mistake)?.slice(0, 200),
  );
  await summary(a);
  check(
    'opening the notebook again reads no attempt twice',
    one(
      `select count(*) from "LearnerMistakeIngest" where "userId" = ${a.userId}`,
    ) === '1' &&
      one(
        `select "wrongCount" from "LearnerMistake" where id = ${mistake.id}`,
      ) === '1',
  );

  // Review: no key in the question; the server checks the answer.
  const review = (await call('GET', '/mistakes/review', a.token)).data;
  const q = review?.items?.[0];
  check(
    'a review question carries no key, no explanation and no earlier choice',
    q?.id === mistake.id &&
      Array.isArray(q.options) &&
      !('correctIndex' in q) &&
      !('explanation' in q) &&
      !('selectedIndex' in q),
    JSON.stringify(q)?.slice(0, 160),
  );
  const right = mistake.detail.correctIndex;
  const wrongIndex = (right + 1) % mistake.detail.options.length;
  let ans = await call('POST', `/mistakes/${mistake.id}/answer`, a.token, {
    selectedIndex: right,
  });
  check(
    'one right answer counts 1/2 and keeps the mistake open',
    ans.data?.correct === true &&
      ans.data?.correctStreak === 1 &&
      ans.data?.resolved === false,
    JSON.stringify(ans.data),
  );
  ans = await call('POST', `/mistakes/${mistake.id}/answer`, a.token, {
    selectedIndex: wrongIndex,
  });
  check(
    'a wrong answer starts the count again and shows the key',
    ans.data?.correct === false &&
      ans.data?.correctStreak === 0 &&
      ans.data?.correctIndex === right,
    JSON.stringify(ans.data),
  );
  await call('POST', `/mistakes/${mistake.id}/answer`, a.token, {
    selectedIndex: right,
  });
  ans = await call('POST', `/mistakes/${mistake.id}/answer`, a.token, {
    selectedIndex: right,
  });
  s = await summary(a);
  check(
    'two right answers in a row close the mistake',
    ans.data?.resolved === true && s?.open === 0 && s?.resolved === 1,
    `${JSON.stringify(ans.data)} ${JSON.stringify(s)}`,
  );

  // Another learner.
  const foreign = await call(
    'POST',
    `/mistakes/${mistake.id}/answer`,
    b.token,
    {
      selectedIndex: right,
    },
  );
  const foreignResolve = await call(
    'POST',
    `/mistakes/${mistake.id}/resolve`,
    b.token,
    {
      resolved: false,
    },
  );
  check(
    'another learner cannot answer or reopen it (404), and sees nothing',
    foreign.status === 404 &&
      foreignResolve.status === 404 &&
      (await list(b)).total === 0,
    `${foreign.status} ${foreignResolve.status}`,
  );
  const anon = await call('GET', '/mistakes/summary', undefined as any);
  check(
    'a signed-out request is refused (401)',
    anon.status === 401,
    String(anon.status),
  );

  // The same question wrong again in a new attempt: open again.
  await grammarAttempt(a, 1);
  items = (await list(a, '?skill=grammar')).items;
  check(
    'the same question wrong in a later attempt opens the mistake again',
    items.length === 1 &&
      items[0].id === mistake.id &&
      items[0].wrongCount === 3 &&
      items[0].resolvedAt === null,
    JSON.stringify(items.map((i: any) => [i.id, i.wrongCount, i.resolvedAt])),
  );
  // Two later attempts with it right: closed by the attempts themselves.
  await grammarAttempt(a, 0);
  await summary(a);
  await grammarAttempt(a, 0);
  s = await summary(a);
  check(
    'two later attempts with it right close it without a review',
    s?.bySkill?.GRAMMAR === 0,
    JSON.stringify(s),
  );

  // Manual close and reopen.
  await grammarAttempt(a, 2);
  items = (await list(a, '?skill=grammar')).items;
  const manual = items.find((i: any) => i.id !== mistake.id) ?? items[0];
  await call('POST', `/mistakes/${manual.id}/resolve`, a.token, {
    resolved: true,
  });
  const closed = (await list(a, '?skill=grammar&status=resolved')).items;
  await call('POST', `/mistakes/${manual.id}/resolve`, a.token, {
    resolved: false,
  });
  const reopened = (await list(a, '?skill=grammar')).items;
  check(
    'the learner can close a mistake and open it again',
    closed.some((i: any) => i.id === manual.id) &&
      reopened.some((i: any) => i.id === manual.id),
  );

  // Reading.
  const r = await readingAttempt(a, true);
  s = await summary(a);
  const reading = (await list(a, '?skill=reading')).items;
  check(
    'a wrong reading answer is in the notebook with its passage and can be answered again',
    r.res.status < 300 &&
      s?.bySkill?.READING === 1 &&
      reading[0]?.detail?.answerable === true &&
      reading[0]?.detail?.passageKind === 'PASSAGE' &&
      reading[0]?.detail?.ref?.questionId === r.firstQuestionId,
    JSON.stringify(reading[0])?.slice(0, 200),
  );

  // TOEIC exam questions are not in the notebook (owner 2026-11-11): a
  // submitted attempt with a wrong answer adds nothing.
  const [qid, correct] = harnessQuery(
    `select q.id, q."correctIndex" from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = 1 and g.part = 5 order by q."questionNumber" limit 1`,
  )[0];
  const start = await call('POST', '/toeic/exams/1/attempts', a.token, {
    mode: 'FULL_TEST',
  });
  const attemptId = Number(start.data?.id);
  await call('POST', `/toeic/attempts/${attemptId}/begin`, a.token, {});
  await call('PATCH', `/toeic/attempts/${attemptId}/answers`, a.token, {
    answers: { [Number(qid)]: (Number(correct) + 1) % 4 },
  });
  const beforeToeic = (await summary(a))?.open;
  const submitted = await call(
    'POST',
    `/toeic/attempts/${attemptId}/submit`,
    a.token,
    {},
  );
  s = await summary(a);
  check(
    'a submitted TOEIC attempt with a wrong answer adds nothing to the notebook',
    submitted.data?.status === 'SUBMITTED' &&
      s?.open === beforeToeic &&
      !('TOEIC' in (s?.bySkill ?? {})) &&
      one(
        `select count(*) from "LearnerMistake" where "userId" = ${a.userId} and skill = 'TOEIC'`,
      ) === '0',
    JSON.stringify(s?.bySkill),
  );
  const toeicFilter = await call('GET', '/mistakes?skill=toeic', a.token);
  check(
    'the notebook has no TOEIC filter (400)',
    toeicFilter.status === 400,
    String(toeicFilter.status),
  );

  // A TOEIC row written before the change stays in the table and is never
  // shown, counted, reviewed or reachable.
  harnessExec(
    `insert into "LearnerMistake" ("userId", skill, "sourceType", "itemKey", tag, detail)
     values (${a.userId}, 'TOEIC', 'TOEIC_QUESTION', 'qa-legacy', 'Part 5',
       '{"kind":"CHOICE","title":"Legacy","options":["a","b"],"correctIndex":1,"answerable":true,"ref":{}}'::jsonb)`,
  );
  const legacyId = Number(
    one(
      `select id from "LearnerMistake" where "userId" = ${a.userId} and "itemKey" = 'qa-legacy'`,
    ),
  );
  s = await summary(a);
  const everything = (await list(a)).items as Array<{ id: number }>;
  const reviewAll = (await call('GET', '/mistakes/review', a.token)).data
    ?.items as Array<{ id: number }>;
  const legacyAnswer = await call(
    'POST',
    `/mistakes/${legacyId}/answer`,
    a.token,
    { selectedIndex: 1 },
  );
  check(
    'an old TOEIC row is not counted, listed, reviewed or answerable (404)',
    s?.open === beforeToeic &&
      !everything.some((i) => i.id === legacyId) &&
      !reviewAll.some((i) => i.id === legacyId) &&
      legacyAnswer.status === 404,
    `${s?.open}/${beforeToeic} ${legacyAnswer.status}`,
  );

  // Writing: a correction of a graded practice answer.
  const wq = Number(
    one(
      `select id from "Question" where "quizId" = 17 order by "order", id limit 1`,
    ),
  );
  const w = await call('POST', '/writing/quizzes/17/submit', a.token, {
    answer:
      'Hi Lan, thanks for your message. My sister ask me to meet you on Saturday at ten near the library. I will bring the notes and we can study together. See you, Minh',
    questionId: wq,
    clientAttemptId: randomUUID(),
  });
  const writing = (await list(a, '?skill=writing')).items;
  check(
    'a correction of a graded Writing answer is in the notebook',
    w.status < 300 &&
      writing.length === 1 &&
      writing[0].detail.kind === 'CORRECTION' &&
      writing[0].detail.yourAnswer === 'sister ask' &&
      writing[0].detail.answerable === false,
    JSON.stringify(writing[0])?.slice(0, 200),
  );
  const noAnswer = await call(
    'POST',
    `/mistakes/${writing[0]?.id}/answer`,
    a.token,
    {
      selectedIndex: 0,
    },
  );
  check(
    'a correction cannot be "answered" (400)',
    noAnswer.status === 400,
    String(noAnswer.status),
  );
  const bad = await call('GET', '/mistakes?skill=vocab', a.token);
  check(
    'an unknown skill is refused (400)',
    bad.status === 400,
    String(bad.status),
  );

  // The tutor is told what the learner gets wrong most.
  const chat = await call('POST', '/ai/chat', a.token, {
    prompt: 'mình nên ôn gì? [[notes]]',
  });
  check(
    'the tutor prompt names the top mistake tags',
    /\[mistakes: .*Ngữ pháp/.test(String(chat.data?.reply)) &&
      !String(chat.data?.reply).includes('Luyện đề'),
    String(chat.data?.reply),
  );
  return a;
}

async function browserFlow() {
  const { browser, page, account, issues } = await studentPage('mis-ui');
  await onboard(account.token);
  unlockAllLevels(account.userId);
  await grammarAttempt(account, 2);
  await readingAttempt(account, true);

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const card = page.getByRole('heading', { name: '3 lỗi chưa khắc phục' });
  await card.waitFor({ timeout: 60_000 });
  check(
    'the dashboard card counts the open mistakes',
    (await card.count()) === 1,
  );
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/mistakes-dashboard-card.png` });

  await page
    .getByRole('button', {
      name: /Tài khoản|Mở menu tài khoản|menu người dùng/i,
    })
    .first()
    .click()
    .catch(() => undefined);
  const entry = page.getByRole('link', { name: /Sổ lỗi/ }).first();
  const inMenu = await entry.isVisible().catch(() => false);
  check(
    'the account menu has "Sổ lỗi" with the count',
    inMenu && /3/.test((await entry.innerText().catch(() => '')) || ''),
    await entry.innerText().catch(() => 'not visible'),
  );
  if (inMenu) await page.screenshot({ path: `${SHOTS}/mistakes-menu.png` });

  await page.goto(`${FE}/mistakes`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page
    .getByRole('heading', { name: 'Sổ lỗi', exact: true })
    .waitFor({ timeout: 60_000 });
  check(
    'the notebook has no "Hỏi gia sư" button and no "Luyện đề" filter',
    (await page.getByRole('button', { name: 'Hỏi gia sư' }).count()) === 0 &&
      (await page.getByRole('button', { name: /^Luyện đề/ }).count()) === 0,
  );
  // Owner 2026-11-12/13: one row per mistake in a panel per exercise, the
  // chosen one in a detail pane; no Chưa / Đã khắc phục filter.
  const rows = page.locator('section[aria-label] li > button');
  check('the notebook lists three mistakes', (await rows.count()) === 3);
  check(
    'one mistake is open in the detail pane',
    (await page.locator('article').count()) === 1,
  );
  check(
    'there is no Chưa / Đã khắc phục filter',
    (await page.getByRole('button', { name: /khắc phục/ }).count()) === 0,
  );
  await page.screenshot({
    path: `${SHOTS}/mistakes-page-1366.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: /^Đọc/ }).click();
  await page.waitForURL(/skill=reading/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  check(
    'the skill filter narrows the list and is in the address',
    (await rows.count()) === 1 &&
      (await page.getByRole('link', { name: 'Làm lại bài đọc' }).count()) >= 1,
  );

  await page.getByRole('button', { name: /^Tất cả/ }).click();
  await page.waitForTimeout(1500);

  // "Đã hiểu" takes a mistake out and offers Hoàn tác (owner 2026-11-13).
  await page
    .getByRole('button', { name: 'Đã hiểu, bỏ khỏi sổ' })
    .first()
    .click();
  const undo = page.getByRole('button', { name: 'Hoàn tác' });
  await undo.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  check(
    '"Đã hiểu" takes the mistake out and offers Hoàn tác',
    (await rows.count()) === 2 &&
      (await page.getByText('Đã bỏ lỗi này khỏi sổ.').count()) === 1,
    `${await rows.count()} rows`,
  );
  await page.screenshot({ path: `${SHOTS}/mistakes-undo-toast.png` });
  await undo.click();
  await page.waitForTimeout(2500);
  check(
    'Hoàn tác brings it back',
    (await rows.count()) === 3,
    `${await rows.count()} rows`,
  );

  await page.getByRole('button', { name: /^Ôn \d+ câu$/ }).click();
  await page
    .getByRole('heading', { name: /Ôn lỗi · Câu 1\/3/ })
    .waitFor({ timeout: 60_000 });
  const send = page.getByRole('button', { name: 'Trả lời' });
  check(
    'a review question cannot be sent without a choice',
    await send.isDisabled(),
  );
  await page.locator('fieldset input[type="radio"]').first().check();
  await send.click();
  const session = page.locator(
    'section[aria-labelledby="mistake-review-heading"]',
  );
  const status = session.getByRole('status');
  await status.waitFor({ timeout: 30_000 });
  const verdict = (await status.innerText()).replace(/\s+/g, ' ');
  check(
    'the answer is checked and the key is marked',
    /^(Đúng\.|Chưa đúng\.)/.test(verdict) &&
      (await session.getByLabel('Đáp án đúng').count()) === 1,
    verdict.slice(0, 120),
  );
  await page.screenshot({
    path: `${SHOTS}/mistakes-review.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Dừng ôn' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check('no sideways scroll at 390 px', overflow <= 0, `overflow ${overflow}`);
  await page.screenshot({
    path: `${SHOTS}/mistakes-page-390.png`,
    fullPage: true,
  });

  await page.goto(`${FE}/reading/mistakes`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForURL(/\/mistakes\?skill=reading/, { timeout: 30_000 });
  check('the old /reading/mistakes address opens the notebook on Đọc', true);

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
