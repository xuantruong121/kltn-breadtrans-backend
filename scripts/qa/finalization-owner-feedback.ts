/**
 * Three things the owner reported on 2026-11-11, on the disposable harness.
 *
 * TOEIC review: after submitting, the key, the worded answer, the
 * explanation and the transcript are there only for answered questions (and,
 * for a transcript, for a listening group with an answered question).
 * Tutor panel: it opens on the latest message, both when the messages are
 * loaded after opening and when they are already in memory; a reader who
 * scrolled up is not pulled down by a new message and sees how many arrived;
 * Shift+Enter makes a new line and Enter sends; the message box has the
 * focus on a desktop.
 * Pet: a hungry pet says so on the first page where it is on screen, even
 * when the learner came through a page that hides it.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-owner-feedback.ts
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, onboard } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const one = (sql: string) => harnessQuery(sql)[0]?.[0];

/** The first question of a part of exam 1, with its group. */
function question(part: number) {
  const [id, number, groupId, correct] = harnessQuery(
    `select q.id, q."questionNumber", q."groupId", q."correctIndex" from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = 1 and g.part = ${part} order by q."questionNumber" limit 1`,
  )[0];
  return {
    id: Number(id),
    number: Number(number),
    groupId: Number(groupId),
    correct: Number(correct),
  };
}

async function toeic(token: string) {
  const p5 = question(5);
  const p3 = question(3);
  const start = await call('POST', '/toeic/exams/1/attempts', token, {
    mode: 'FULL_TEST',
  });
  const attemptId = Number(start.data?.id);
  await call('POST', `/toeic/attempts/${attemptId}/begin`, token, {});
  await call('PATCH', `/toeic/attempts/${attemptId}/answers`, token, {
    // One wrong answer in Part 5, one right answer in Part 3.
    answers: { [p5.id]: (p5.correct + 1) % 4, [p3.id]: p3.correct },
  });
  await call('POST', `/toeic/attempts/${attemptId}/submit`, token, {});
  const review = (
    await call('GET', `/toeic/attempts/${attemptId}/review`, token)
  ).data;
  const questions: any[] = review?.questions ?? [];
  const keyed = questions.filter((q) => q.correctIndex !== null);
  const skipped = questions.filter((q) => q.selectedIndex === null);
  check(
    'the review still lists every question of the attempt',
    questions.length >= 100 && skipped.length === questions.length - 2,
    `${questions.length} questions, ${skipped.length} skipped`,
  );
  check(
    'only the two answered questions come with a key',
    keyed.length === 2 &&
      keyed.every((q) => [p5.id, p3.id].includes(q.questionId)) &&
      keyed.find((q) => q.questionId === p5.id)?.correctIndex === p5.correct,
    `${keyed.length} with a key`,
  );
  check(
    'a skipped question has no key, no worded answer and no explanation',
    skipped.every(
      (q) =>
        q.correctIndex === null &&
        q.standardAnswer === null &&
        q.explanation === null,
    ),
  );
  const withTranscript = questions.filter((q) => q.transcript);
  check(
    'a transcript is there only for the listening group with an answered question',
    withTranscript.length > 0 &&
      withTranscript.every((q) => q.groupId === p3.groupId),
    `${withTranscript.length} questions with a transcript, groups ${[...new Set(withTranscript.map((q) => q.groupId))].join(',')}`,
  );
  check(
    'the totals are unchanged: 1 right, 1 wrong, the rest skipped',
    review?.summary?.overall?.correct === 1 &&
      review?.summary?.overall?.incorrect === 1 &&
      review?.summary?.overall?.skipped === questions.length - 2,
    JSON.stringify(review?.summary?.overall),
  );
  return { attemptId, p5 };
}

async function main() {
  const { browser, page, account, issues } = await studentPage('fb-ui');
  await onboard(account.token);

  // ---------------------------------------------------------------- pet
  // The pet is made hungry (a new pet starts at 80, which is not hungry).
  await call('GET', '/gamification/pet', account.token);
  harnessExec(
    `update "UserPet" set roster = (select jsonb_object_agg(key, value || jsonb_build_object('satiety', 30, 'stateUpdatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) from jsonb_each(roster)) where "userId" = ${account.userId}`,
  );
  const pet = (await call('GET', '/gamification/pet', account.token)).data;
  check(
    'the pet is hungry',
    pet?.satietyState === 'HUNGRY',
    String(pet?.satietyState),
  );

  // The dashboard has no floating pet: the pet's own card says it is hungry.
  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const inCard = page.locator('[data-pet-hunger="hungry"]');
  const cardSays = await inCard
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(
    'on the dashboard the pet card says it is hungry',
    cardSays,
    cardSays
      ? (await inCard.first().innerText()).replace(/\s+/g, ' ')
      : 'no line',
  );
  if (cardSays) {
    await inCard.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/pet-hungry-dashboard-card.png` });
  }
  await page.goto(`${FE}/pet`, { waitUntil: 'networkidle', timeout: 120_000 });
  check(
    'the pet page says it too',
    await inCard
      .first()
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false),
  );

  // A practice room hides the pet; the line must still be said on the next
  // page that shows the floating pet.
  const quizId = Number(
    one(
      `select q.id from "Quiz" q where q.type = 'BILINGUAL_READING' and q."publicationStatus" = 'PUBLISHED' order by q.id limit 1`,
    ),
  );
  await page.goto(`${FE}/reading/${quizId}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(4000);
  const bubble = page.locator('[role="dialog"][aria-label$="Đang đói"]');
  check(
    'in a practice room the pet and its bubble are not shown',
    (await bubble.count()) === 0,
  );
  await page.goto(`${FE}/ranking`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const said = await bubble
    .first()
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  check(
    'on the next page with the floating pet, its bubble says it is hungry',
    said,
    said
      ? (await bubble.first().innerText()).replace(/\s+/g, ' ').slice(0, 120)
      : 'no bubble',
  );
  if (said) await page.screenshot({ path: `${SHOTS}/pet-hungry-bubble.png` });
  // Said once: a reload does not bring the same bubble back.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  check('a reload does not repeat the bubble', (await bubble.count()) === 0);

  // ---------------------------------------------------------------- TOEIC
  const { attemptId, p5 } = await toeic(account.token);
  await page.goto(`${FE}/toeic/review/${attemptId}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.locator(`#q-${p5.number}`).waitFor({ timeout: 60_000 });
  const marked = await page.getByText('Đáp án đúng', { exact: true }).count();
  const hidden = await page
    .getByText('Bạn chưa trả lời câu này nên đáp án không hiển thị', {
      exact: false,
    })
    .count();
  check(
    'the review page marks a right choice on two questions only, and says why the others have none',
    marked === 2 && hidden >= 100,
    `${marked} marked, ${hidden} notices`,
  );
  await page.locator(`#q-${p5.number}`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/toeic-review-answered-only.png` });

  // ---------------------------------------------------------------- tutor panel
  const conv = (await call('GET', '/support/conversations/me', account.token))
    .data;
  for (let i = 1; i <= 12; i += 1)
    await call(
      'POST',
      `/support/conversations/${conv.id}/messages`,
      account.token,
      {
        content: `Câu hỏi số ${i}: phân biệt since và for trong thì hiện tại hoàn thành như thế nào?`,
        clientMessageId: randomUUID(),
      },
    );
  const stored = Number(
    one(
      `select count(*) from "SupportMessage" where "conversationId" = ${conv.id}`,
    ),
  );

  const log = page.locator('[role="log"][aria-label="Tin nhắn"]');
  const gap = () =>
    log.evaluate((el) => ({
      gap: el.scrollHeight - el.scrollTop - el.clientHeight,
      scrollable: el.scrollHeight > el.clientHeight + 200,
      top: el.scrollTop,
    }));
  const openPanel = async () => {
    await page
      .getByRole('button', { name: /Hỏi trợ lý học tập/ })
      .first()
      .click();
    await log.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
  };

  // Fresh page: the messages are loaded after the panel opens.
  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await openPanel();
  let m = await gap();
  check(
    `the panel opens on the latest of ${stored} messages (loaded after opening)`,
    stored >= 20 && m.scrollable && m.gap < 80,
    JSON.stringify(m),
  );
  check(
    'the message box has the focus',
    await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'),
  );
  await page.screenshot({ path: `${SHOTS}/tutor-panel-opens-at-latest.png` });

  // Closed and opened again: the messages are already in memory.
  await page.keyboard.press('Escape');
  await log.waitFor({ state: 'detached', timeout: 30_000 });
  await openPanel();
  m = await gap();
  check(
    'opened again, it is on the latest message too',
    m.gap < 80,
    JSON.stringify(m),
  );

  // A reader who scrolled up stays there when a message arrives.
  await log.evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForTimeout(600);
  const jump = page.getByRole('button', { name: /^Tin mới nhất/ });
  check(
    'away from the end, a "Tin mới nhất" button is shown',
    (await jump.count()) === 1 &&
      (await jump.innerText()).trim() === 'Tin mới nhất',
    (await jump.count()) ? await jump.innerText() : 'no button',
  );
  harnessExec(
    `insert into "SupportMessage" ("conversationId", "senderRole", "senderName", content) values (${conv.id}, 'AI', 'Trợ Lý Bánh Mì', 'Tin đến khi bạn đang đọc tin cũ.')`,
  );
  await page
    .getByRole('button', { name: 'Tin mới nhất (1)' })
    .waitFor({ timeout: 20_000 })
    .catch(() => undefined);
  m = await gap();
  check(
    'a new message does not pull the reader down, and is counted on the button',
    m.top < 60 && (await jump.innerText()).trim() === 'Tin mới nhất (1)',
    `${JSON.stringify(m)} ${await jump.innerText().catch(() => '')}`,
  );
  await jump.click();
  await page.waitForTimeout(1200);
  m = await gap();
  check(
    'the button goes to the latest message and then disappears',
    m.gap < 80 && (await jump.count()) === 0,
    JSON.stringify(m),
  );

  // The message box.
  const box = page.locator('textarea[aria-label="Nội dung tin nhắn"]');
  const before = Number(
    one(
      `select count(*) from "SupportMessage" where "conversationId" = ${conv.id} and "senderRole" = 'STUDENT'`,
    ),
  );
  await box.click();
  await page.keyboard.type('dòng một');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('dòng hai');
  check(
    'Shift+Enter makes a new line and sends nothing',
    (await box.inputValue()) === 'dòng một\ndòng hai' &&
      Number(
        one(
          `select count(*) from "SupportMessage" where "conversationId" = ${conv.id} and "senderRole" = 'STUDENT'`,
        ),
      ) === before,
    JSON.stringify(await box.inputValue()),
  );
  const tall = await box.evaluate((el) => el.clientHeight);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  m = await gap();
  check(
    'Enter sends the two lines as one message, empties the box and keeps the view at the end',
    (await box.inputValue()) === '' &&
      one(
        `select replace(content, chr(10), '|') from "SupportMessage" where "conversationId" = ${conv.id} and "senderRole" = 'STUDENT' order by id desc limit 1`,
      ) === 'dòng một|dòng hai' &&
      m.gap < 80,
    JSON.stringify(m),
  );
  const short = await box.evaluate((el) => el.clientHeight);
  check(
    'the box grows with its text and shrinks back',
    tall > short,
    `${tall} > ${short}`,
  );

  check(
    'no console or network errors',
    issues.length === 0,
    issues.slice(0, 3).join(' | '),
  );
  await browser.close();
}

void (async () => {
  await main();
  console.log(`\nFAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
