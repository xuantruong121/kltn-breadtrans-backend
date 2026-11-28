/**
 * Adaptive vocabulary review on the disposable harness (owner 2026-11-11).
 *
 * API: a deck word starts with the preview of a new word; each grade stores
 * the word's own interval and ease and moves the preview; "Học lại" brings the
 * word back in ten minutes; a caller that only sends isCorrect still works; a
 * bad grade is refused. Since 2026-11-26 the room sends `evidence` (its steps)
 * and the server decides the grade; bad evidence is refused.
 * Browser: the room shows no rating buttons. A word learned through the steps
 * and a word on "Đã nhớ" get the system's grade, the interval the
 * server previewed for it, and that row in the database.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-vocab-srs.ts
 */
import { call, check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const row = (userId: number, wordId: number) => {
  const r = harnessQuery(
    `select "intervalDays", "easeFactor", lapses, "isMastered", "reviewCount", round(extract(epoch from ("nextReviewAt" - "lastReviewedAt"))) from "UserVocabWordProgress" where "userId" = ${userId} and "wordId" = ${wordId}`,
  )[0];
  return r
    ? {
        intervalDays: Number(r[0]),
        easeFactor: Number(r[1]),
        lapses: Number(r[2]),
        isMastered: r[3] === 't',
        reviewCount: Number(r[4]),
        gapSeconds: Number(r[5]),
      }
    : null;
};

async function main() {
  const { browser, page, account, issues } = await studentPage('vocab-srs');
  const { token, userId } = account;

  const topics = await call('GET', '/vocab/topics', token);
  const all: any[] = (topics.data?.categories ?? topics.data ?? []).flatMap(
    (c: any) => c.topics ?? [c],
  );
  let topicId = 0;
  let words: any[] = [];
  for (const t of all) {
    const detail = await call('GET', `/vocab/topics/${t.id}`, token);
    if (detail.status === 200 && (detail.data?.words?.length ?? 0) >= 3) {
      topicId = t.id;
      words = detail.data.words;
      break;
    }
  }
  check(
    'a deck the learner can open has words',
    topicId > 0,
    `topic ${topicId}`,
  );
  if (!topicId) throw new Error('no deck to test with');
  const [a, b, c] = words;

  // ---- API
  check(
    'a new word previews 10 minutes / 1 day / 1 day / 4 days',
    JSON.stringify(a.reviewPreview) ===
      JSON.stringify({ AGAIN: 0, HARD: 1, GOOD: 1, EASY: 4 }),
    JSON.stringify(a.reviewPreview),
  );

  const preview = async (wordId: number) =>
    (await call('GET', `/vocab/topics/${topicId}`, token)).data.words.find(
      (w: any) => w.id === wordId,
    ).reviewPreview;

  let res = await call('POST', `/vocab/words/${a.id}/review`, token, {
    grade: 'EASY',
    isCorrect: true,
  });
  let r = row(userId, a.id);
  check(
    '"Dễ" on a new word: 4 days, ease 2.65, known',
    res.status < 300 &&
      r?.intervalDays === 4 &&
      r.easeFactor === 2.65 &&
      r.isMastered &&
      r.gapSeconds === 4 * 86400,
    JSON.stringify(r),
  );
  const afterEasy = await preview(a.id);
  check(
    'the preview moves with the word: next "Tốt" is 11 days',
    afterEasy.GOOD === 11 && afterEasy.HARD === 5 && afterEasy.EASY === 14,
    JSON.stringify(afterEasy),
  );

  res = await call('POST', `/vocab/words/${a.id}/review`, token, {
    grade: 'AGAIN',
    isCorrect: false,
  });
  r = row(userId, a.id);
  check(
    '"Học lại": back in ten minutes, one lapse, lower ease, not known',
    r?.intervalDays === 0 &&
      r.lapses === 1 &&
      r.easeFactor === 2.45 &&
      !r.isMastered &&
      r.gapSeconds === 600,
    JSON.stringify(r),
  );

  res = await call('POST', `/vocab/words/${b.id}/review`, token, {
    isCorrect: true,
  });
  r = row(userId, b.id);
  check(
    'isCorrect alone still works: a first right answer gives 1 day',
    res.status < 300 && r?.intervalDays === 1 && r.isMastered === true,
    JSON.stringify(r),
  );
  res = await call('POST', `/vocab/words/${b.id}/review`, token, {
    isCorrect: true,
  });
  r = row(userId, b.id);
  check(
    'a second right answer grows the interval to 3 days',
    r?.intervalDays === 3 && r.reviewCount === 2,
    JSON.stringify(r),
  );

  res = await call('POST', `/vocab/words/${b.id}/review`, token, {
    grade: 'PERFECT',
    isCorrect: true,
  });
  check(
    'an unknown grade is refused with 400',
    res.status === 400,
    `${res.status}`,
  );

  // The room's steps decide the grade (thesis supervisor 2026-11-26).
  const steps = {
    quiz: 'CORRECT',
    typing: 'CORRECT',
    typingHints: 0,
    speaking: 'SKIPPED',
    quickCheck: false,
  };
  res = await call('POST', `/vocab/words/${c.id}/review`, token, {
    evidence: { ...steps, quickCheck: true },
  });
  r = row(userId, c.id);
  check(
    'a clean quick check is graded "Dễ": 4 days, known',
    res.status < 300 &&
      res.data?.grade === 'EASY' &&
      r?.intervalDays === 4 &&
      r.isMastered,
    `${res.data?.grade} ${JSON.stringify(r)}`,
  );
  res = await call('POST', `/vocab/words/${c.id}/review`, token, {
    evidence: { ...steps, typing: 'WRONG' },
  });
  check(
    'a wrong typing is graded "Khó"',
    res.status < 300 && res.data?.grade === 'HARD',
    `${res.status} ${res.data?.grade}`,
  );
  res = await call('POST', `/vocab/words/${c.id}/review`, token, {
    evidence: { ...steps, quiz: 'RIGHT' },
  });
  check(
    'steps the server cannot read are refused with 400',
    res.status === 400,
    `${res.status}`,
  );

  res = await call('POST', `/vocab/words/${b.id}/master`, token, {
    isMastered: true,
  });
  r = row(userId, b.id);
  check(
    '"Đã thuộc" keeps its 7 days and the later reviews grow from there',
    r?.intervalDays === 7 && (await preview(b.id)).GOOD === 18,
    JSON.stringify(r),
  );

  // ---- Browser: the room grades the word itself
  await page.goto(`${FE}/flashcard/${topicId}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2500);
  const startButton = page
    .locator('a,button')
    .filter({ hasText: /^(Học từ vựng|Bắt đầu học|Học ngay|Tiếp tục học)/ })
    .first();
  if (await startButton.count()) {
    await startButton.click();
    await sleep(2500);
  }
  const says = (days: number) =>
    days < 1
      ? '10 phút'
      : days < 30
        ? `${days} ngày`
        : days < 365
          ? `${Math.round(days / 30)} tháng`
          : '1 năm';
  const wordOnScreen = async () => {
    const texts = (await page.locator('h2,h1').allInnerTexts()).map((t) =>
      t.trim(),
    );
    return words.find((w) => texts.includes(w.word));
  };
  // One word through the room: quiz and typing right, then the grade.
  const learnWord = async (quick: boolean) => {
    const shown = await wordOnScreen();
    if (!shown) return null;
    const expected = await preview(shown.id);
    const before = row(userId, shown.id);
    await page.keyboard.press(quick ? 'Tab' : 'Enter');
    await sleep(900);
    await page
      .locator('button')
      .filter({ hasText: shown.meaning })
      .first()
      .click({ timeout: 20_000 });
    await sleep(1600);
    await page.locator('input[type="text"]').first().fill(shown.word);
    await page.keyboard.press('Enter');
    await sleep(1800);
    if (!quick) {
      await page.getByText('Bỏ qua phần phát âm').click({ timeout: 20_000 });
    }
    await sleep(2000);
    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    const after = row(userId, shown.id);
    return { shown, expected, before, after, body };
  };

  const steps1 = await learnWord(false);
  check(
    'no rating buttons anywhere in the room',
    (await page.locator('button').filter({ hasText: 'Ôn lại sau' }).count()) ===
      0,
    '',
  );
  check(
    'a word learned through the steps (speaking skipped) is "Tốt", with the previewed interval',
    steps1 !== null &&
      steps1.body.includes(`Tốt · ôn lại sau ${says(steps1.expected.GOOD)}`) &&
      steps1.after?.intervalDays === steps1.expected.GOOD &&
      steps1.after?.reviewCount === (steps1.before?.reviewCount ?? 0) + 1,
    steps1
      ? `${steps1.shown.word}: ${JSON.stringify(steps1.after)} | ${steps1.body.slice(0, 160)}`
      : 'no word on screen',
  );
  await page.screenshot({ path: `${SHOTS}/vocab-srs-verdict.png` });
  await page.keyboard.press('Enter');
  await sleep(1500);

  const steps2 = await learnWord(true);
  check(
    'a word on "Đã nhớ" answered right is "Dễ"',
    steps2 !== null &&
      steps2.body.includes(`Dễ · ôn lại sau ${says(steps2.expected.EASY)}`) &&
      steps2.after?.intervalDays === steps2.expected.EASY,
    steps2
      ? `${steps2.shown.word}: ${JSON.stringify(steps2.after)} | ${steps2.body.slice(0, 160)}`
      : 'no word on screen',
  );

  check(
    'no console or network errors in the room',
    issues.length === 0,
    issues.slice(0, 3).join(' | '),
  );
  await browser.close();
  console.log(`\nFAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
