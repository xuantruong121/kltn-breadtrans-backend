/**
 * "Hỏi gia sư" on an answered item, on the disposable harness (owner
 * 2026-11-11). The browser sends only ids; the server reads the item and
 * gives it to the tutor, only for the learner's own submitted attempt.
 *
 * The harness AI stub answers "Deterministic chat response." and, when an
 * item reached the prompt, adds "[item: <label>] [key: <right answer>]".
 *
 * API: a TOEIC item is attached after the attempt is submitted, not while it
 * is in progress, and never for another learner; a reading item and a
 * grammar item are attached from the learner's own submissions; an unknown
 * source is ignored.
 * Browser: the button on the TOEIC review page opens the tutor panel with
 * the item shown, the reply is about that item, and removing the item goes
 * back to a plain question.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-tutor-context.ts
 */
import { randomUUID } from 'crypto';

import {
  call,
  check,
  failureCount,
  newStudent,
  onboard,
  unlockAllLevels,
} from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const PLAIN = 'Deterministic chat response.';

type Ref = { sourceType: string; sourceId: number; questionId?: number };
async function ask(token: string, content: string, context?: Ref) {
  const conv = (await call('GET', '/support/conversations/me', token)).data;
  const res = await call(
    'POST',
    `/support/conversations/${conv.id}/messages`,
    token,
    { content, clientMessageId: randomUUID(), ...(context ? { context } : {}) },
  );
  return String(res.data?.aiReply?.content ?? `status ${res.status}`);
}

/** A Part 5 question of exam 1 and its key, read from the harness database. */
function part5() {
  const [id, number, options, correct] = harnessQuery(
    `select q.id, q."questionNumber", q.options::text, q."correctIndex" from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = 1 and g.part = 5 order by q."questionNumber" limit 1`,
  )[0];
  const list: string[] = JSON.parse(options);
  return {
    id: Number(id),
    number: Number(number),
    key: `${'ABCD'[Number(correct)]}. ${list[Number(correct)]}`,
    wrong: (Number(correct) + 1) % list.length,
  };
}

async function toeicAttempt(token: string, q: ReturnType<typeof part5>) {
  const start = await call('POST', '/toeic/exams/1/attempts', token, {
    mode: 'FULL_TEST',
  });
  const id = Number(start.data?.id);
  await call('POST', `/toeic/attempts/${id}/begin`, token, {});
  await call('PATCH', `/toeic/attempts/${id}/answers`, token, {
    answers: { [q.id]: q.wrong },
  });
  return id;
}

async function api() {
  const a = await newStudent('ctx-a');
  const b = await newStudent('ctx-b');
  const q = part5();
  const label = `Câu ${q.number}, Part 5, đề luyện TOEIC đã nộp`;

  const attemptId = await toeicAttempt(a.token, q);
  const ref = {
    sourceType: 'TOEIC_ATTEMPT',
    sourceId: attemptId,
    questionId: q.id,
  };

  let reply = await ask(a.token, 'đáp án câu này là gì?', ref);
  check(
    'an attempt in progress gives the tutor no item and no key',
    reply === PLAIN,
    reply,
  );

  const sub = await call(
    'POST',
    `/toeic/attempts/${attemptId}/submit`,
    a.token,
    {},
  );
  reply = await ask(a.token, 'vì sao mình sai?', ref);
  check(
    'after submit the tutor gets the item and its key',
    sub.data?.status === 'SUBMITTED' &&
      reply === `${PLAIN} [item: ${label}] [key: ${q.key}]`,
    reply,
  );

  reply = await ask(b.token, 'đáp án là gì?', ref);
  check("another learner's attempt gives nothing", reply === PLAIN, reply);

  reply = await ask(a.token, 'câu khác', { ...ref, questionId: 99_999_999 });
  check('a question outside the exam gives nothing', reply === PLAIN, reply);

  reply = await ask(a.token, 'thử', {
    sourceType: 'USER',
    sourceId: a.userId,
  });
  check('an unknown source is ignored', reply === PLAIN, reply);

  const viaChat = await call('POST', '/ai/chat', a.token, {
    prompt: 'giải thích giúp mình',
    context: ref,
  });
  check(
    'POST /ai/chat takes the same context',
    String(viaChat.data?.reply).includes(`[item: ${label}]`),
    String(viaChat.data?.reply),
  );

  // A reading quiz the learner submitted.
  await onboard(a.token);
  unlockAllLevels(a.userId);
  const quizId = Number(
    harnessQuery(
      `select q.id from "Quiz" q where q.type = 'BILINGUAL_READING' and q."publicationStatus" = 'PUBLISHED' and exists (select 1 from "Question" x where x."quizId" = q.id) order by q.id limit 1`,
    )[0][0],
  );
  const quiz = await call('GET', `/quizzes/${quizId}`, a.token);
  const questions: any[] = quiz.data?.questions ?? [];
  const keys = harnessQuery(
    `select id, content::text from "Question" where "quizId" = ${quizId} order by "order", id`,
  ).map(([id, content]) => ({ id: Number(id), content: JSON.parse(content) }));
  const submitted = await call('POST', `/quizzes/${quizId}/submit`, a.token, {
    answers: questions.map((item) => {
      const c = keys.find((k) => k.id === item.id)!.content;
      return { questionId: item.id, answer: c.options[c.correctIndex] };
    }),
    clientAttemptId: randomUUID(),
  });
  const submissionId = Number(
    harnessQuery(
      `select id from "Submission" where "userId" = ${a.userId} and "quizId" = ${quizId} order by id desc limit 1`,
    )[0]?.[0],
  );
  const second = keys[1] ?? keys[0];
  reply = await ask(a.token, 'giải thích câu này', {
    sourceType: 'QUIZ_SUBMISSION',
    sourceId: submissionId,
    questionId: second.id,
  });
  check(
    'a reading item of the learner own submission is attached',
    submitted.status < 300 &&
      reply.startsWith(
        `${PLAIN} [item: Câu ${keys.indexOf(second) + 1}, bài luyện đọc`,
      ) &&
      reply.includes(`[key: ${'ABCD'[second.content.correctIndex]}. `),
    reply,
  );
  reply = await ask(b.token, 'giải thích câu này', {
    sourceType: 'QUIZ_SUBMISSION',
    sourceId: submissionId,
    questionId: second.id,
  });
  check("another learner's submission gives nothing", reply === PLAIN, reply);

  // A grammar attempt.
  const topicId = Number(
    harnessQuery(
      `select t.id from "GrammarTopic" t where t."publicationStatus" = 'PUBLISHED' and exists (select 1 from "GrammarQuestion" g where g."topicId" = t.id) order by t.id limit 1`,
    )[0][0],
  );
  const gq = harnessQuery(
    `select id, "correctIndex" from "GrammarQuestion" where "topicId" = ${topicId} order by "order", id`,
  ).map(([id, correct]) => ({ id: Number(id), correct: Number(correct) }));
  const attempt = await call(
    'POST',
    `/grammar/topics/${topicId}/attempt`,
    a.token,
    {
      answers: Object.fromEntries(gq.map((x) => [String(x.id), x.correct])),
    },
  );
  reply = await ask(a.token, 'giải thích', {
    sourceType: 'GRAMMAR_ATTEMPT',
    sourceId: Number(attempt.data?.attemptId),
    questionId: gq[0].id,
  });
  check(
    'a grammar item of the learner own attempt is attached',
    reply.startsWith(`${PLAIN} [item: Câu 1, bài ngữ pháp`),
    reply,
  );
}

async function browserFlow() {
  const { browser, page, account, issues } = await studentPage('ctx-ui');
  await onboard(account.token);
  const q = part5();
  const attemptId = await toeicAttempt(account.token, q);
  await call('POST', `/toeic/attempts/${attemptId}/submit`, account.token, {});

  await page.goto(`${FE}/toeic/review/${attemptId}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(3000);
  const article = page.locator(`#q-${q.number}`);
  const button = article.getByRole('button', { name: 'Hỏi gia sư' });
  check(
    'each reviewed item has a "Hỏi gia sư" button',
    (await button.count()) === 1,
  );
  await button.click();
  const panel = page.locator(
    '[role="dialog"][aria-label="Cửa sổ hỗ trợ trực tuyến BreadTrans"]',
  );
  await panel.waitFor({ timeout: 20_000 });
  const text = () => panel.innerText().then((t) => t.replace(/\s+/g, ' '));
  check(
    'the panel opens with the item shown',
    (await text()).includes(`Đang hỏi về: Câu ${q.number}, Part 5`),
    (await text()).slice(0, 160),
  );
  await page.screenshot({ path: `${SHOTS}/tutor-context-chip.png` });

  await panel
    .getByRole('button', { name: 'Vì sao đáp án của mình sai?' })
    .click();
  const input = panel.locator('input[type="text"]');
  check(
    'a suggested question fills the box',
    (await input.inputValue()) === 'Vì sao đáp án của mình sai?',
  );
  await input.press('Enter');
  await panel
    .getByText(`[key: ${q.key}]`)
    .waitFor({ timeout: 30_000 })
    .catch(() => undefined);
  check(
    'the reply is about that item, with the key read on the server',
    (await text()).includes(
      `[item: Câu ${q.number}, Part 5, đề luyện TOEIC đã nộp] [key: ${q.key}]`,
    ),
    (await text()).slice(-200),
  );
  await page.screenshot({ path: `${SHOTS}/tutor-context-reply.png` });

  await panel.getByRole('button', { name: 'Bỏ câu đang hỏi' }).click();
  await input.fill('present perfect là gì?');
  await input.press('Enter');
  await sleep(4000);
  const after = await text();
  check(
    'with the item removed the next question is a plain one',
    !after.includes('Đang hỏi về:') &&
      after.trim().split('present perfect là gì?').pop()!.includes(PLAIN) &&
      !after.trim().split('present perfect là gì?').pop()!.includes('[item:'),
    after.slice(-160),
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
