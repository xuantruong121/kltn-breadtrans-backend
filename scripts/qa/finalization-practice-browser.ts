/**
 * Listening and Reading practice, end to end in a real browser, on the
 * disposable harness. Audio streaming is not available there (private R2
 * credentials are blanked), so a failed audio request is expected and is the
 * only 5xx tolerated.
 */
import { check, failureCount } from './harness-api';
import { harnessQuery } from './harness-db';
import { FE, studentPage } from './harness-browser';

const AUDIO_5XX =
  /^api 5\d\d GET \/quizzes\/\d+\/(questions\/\d+\/audio|transcript\/audio)/;

async function listening() {
  console.log('\n== Listening (browser)');
  const { browser, page, account, issues } = await studentPage('listen-ui');
  const quizId = 26; // FREE A2 conversation (quiz 28 is B2 PLUS since Checkpoint 51)
  await page.goto(`${FE}/listening/${quizId}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  const total = Number(
    harnessQuery(
      `select count(*) from "Question" where "quizId" = ${quizId}`,
    )[0][0],
  );
  for (let i = 0; i < total; i += 1) {
    // Options render "(A)" in a span; the button's accessible name varies.
    const option = page.getByText('(A)', { exact: false }).first();
    await option.waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(1500);
    await option.click();
    // Answering checks the question; then either "next" or "submit" appears.
    const next = page.getByRole('button', { name: /Câu tiếp theo/ });
    const submit = page.getByRole('button', { name: /^Nộp bài$/ });
    await next
      .or(submit)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    if (i < total - 1) {
      await next.click();
      await page.waitForTimeout(800);
    }
  }
  const visible = await page.$$eval('button', (bs) =>
    bs
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => (b.textContent ?? '').trim()),
  );
  const finish = visible.find((t) => /Nộp bài|Xem kết quả|Hoàn thành/.test(t));
  check(
    'the last question offers a way to finish',
    !!finish,
    `(${visible.slice(-4).join(' | ')})`,
  );
  if (finish) {
    await page.getByRole('button', { name: finish }).first().click();
    const confirm = page.getByRole('button', {
      name: /^(Nộp bài|Xác nhận nộp|Nộp)$/,
    });
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false))
      await confirm.click();
    await page
      .waitForURL(/\/listening\/submissions\/\d+/, { timeout: 60_000 })
      .catch(() => undefined);
    if (!/submissions/.test(page.url())) {
      await page.screenshot({
        path: 'artifacts/finalization/evidence/listening-submit-stuck.png',
      });
      const dialog = await page
        .locator('[role="dialog"], [role="alertdialog"], [data-sonner-toast]')
        .allInnerTexts();
      console.log('after submit:', JSON.stringify(dialog).slice(0, 600));
    }
  }
  const url = page.url();
  check(
    'lands on the submission result page',
    /\/listening\/submissions\/\d+/.test(url),
    `(${url.slice(21)})`,
  );
  const submissionId = Number(/submissions\/(\d+)/.exec(url)?.[1]);
  if (submissionId) {
    const [row] = harnessQuery(
      `select score, "userId" from "Submission" where id = ${submissionId}`,
    );
    const [owner] = harnessQuery(
      `select id from "User" where email = '${account.email}'`,
    );
    check('the submission belongs to this learner', row?.[1] === owner?.[0]);
    await page.waitForTimeout(2000);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, '');
    check(
      'the result page shows the persisted score',
      text.includes(`${row?.[0]}/${total}`),
      `(db score ${row?.[0]}/${total})`,
    );
    await page.screenshot({
      path: 'artifacts/finalization/evidence/listening-result.png',
      fullPage: true,
    });
  }
  const unexpected = issues.filter(
    (x) => x.startsWith('api 5') && !AUDIO_5XX.test(x),
  );
  check(
    'no unexpected server error',
    unexpected.length === 0,
    unexpected.join(' | '),
  );
  await browser.close();
}

async function reading() {
  console.log('\n== Reading (browser)');
  const { browser, page, account, issues } = await studentPage('read-ui');
  const quizId = 2;
  const keys = harnessQuery(
    `select id, content::text from "Question" where "quizId" = ${quizId} order by "order", id`,
  ).map(([id, content]) => ({ id: Number(id), content: JSON.parse(content) }));
  await page.goto(`${FE}/reading/${quizId}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.waitForTimeout(2000);
  for (let i = 0; i < keys.length; i += 1) {
    await page
      .getByRole('button', { name: String(i + 1), exact: true })
      .first()
      .click();
    await page.waitForTimeout(600);
    // Each option button's text is its letter followed by the option text.
    await page
      .locator(`[data-reading-question-index="${i}"]`)
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
    const firstOption: string = keys[i].content.options[0];
    await page
      .getByRole('button')
      .filter({ hasText: firstOption })
      .first()
      .click();
    await page.waitForTimeout(400);
  }
  const submit = page.getByRole('button', { name: /^Nộp bài/ }).first();
  const canSubmit = await submit
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  check(
    'a submit control is visible after answering every question',
    canSubmit,
  );
  if (canSubmit) {
    await submit.click();
    const confirm = page.getByRole('button', {
      name: /^(Nộp bài|Xác nhận nộp|Nộp)$/,
    });
    if (
      await confirm
        .nth(1)
        .isVisible({ timeout: 2000 })
        .catch(() => false)
    )
      await confirm.nth(1).click();
    await page
      .waitForURL(/\/reading\/submissions\/\d+/, { timeout: 60_000 })
      .catch(() => undefined);
  }
  const url = page.url();
  check(
    'lands on the reading result page',
    /\/reading\/submissions\/\d+/.test(url),
    `(${url.slice(21)})`,
  );
  const submissionId = Number(/submissions\/(\d+)/.exec(url)?.[1]);
  if (submissionId) {
    const [row] = harnessQuery(
      `select s.score from "Submission" s join "User" u on u.id = s."userId" where s.id = ${submissionId} and u.email = '${account.email}'`,
    );
    const answers = harnessQuery(
      `select "questionId", answer::text from "Result" where "submissionId" = ${submissionId}`,
    );
    check(
      'every question was recorded',
      answers.length === keys.length,
      `(${answers.length}/${keys.length})`,
    );
    const keyOf = (c: any): string | undefined =>
      Number.isInteger(c.correctIndex)
        ? c.options?.[c.correctIndex]
        : (c.correct ?? c.correctAnswer);
    const expected = keys.filter(
      (k) => keyOf(k.content) === k.content.options[0],
    ).length;
    check(
      'stored score equals the count computed from the keys',
      Number(row?.[0]) === expected,
      `(db ${row?.[0]}, expected ${expected})`,
    );
    await page.waitForTimeout(2000);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, '');
    check(
      'the result page shows the persisted score',
      !!row && text.includes(`${row[0]}/${keys.length}`),
      `(db ${row?.[0]}/${keys.length})`,
    );
    await page.screenshot({
      path: 'artifacts/finalization/evidence/reading-result.png',
      fullPage: true,
    });
  } else {
    await page.screenshot({
      path: 'artifacts/finalization/evidence/reading-stuck.png',
      fullPage: true,
    });
  }
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api 5')).join(' | '),
  );
  await browser.close();
}

async function grammar() {
  console.log('\n== Grammar (browser, topic published in the clone)');
  const { browser, page, account, issues } = await studentPage('grammar-ui');
  const topicId = Number(
    harnessQuery(
      `select id from "GrammarTopic" where "publicationStatus"::text = 'PUBLISHED' order by id limit 1`,
    )[0]?.[0],
  );
  if (!topicId) {
    check(
      'a published grammar topic exists in the clone (run finalization-grammar-vocab-api.ts first)',
      false,
    );
    await browser.close();
    return;
  }
  const qs = harnessQuery(
    `select options::text, "correctIndex" from "GrammarQuestion" where "topicId" = ${topicId} order by "order", id`,
  ).map(([o, c]) => ({
    options: JSON.parse(o) as string[],
    correct: Number(c),
  }));
  await page.goto(`${FE}/reading?category=grammar&topicId=${topicId}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.waitForTimeout(2000);
  if (
    !(await page
      .getByRole('button', { name: /Câu tiếp|Câu trước/ })
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Bắt đầu' }).first().click();
    await page.waitForTimeout(3000);
  }
  for (let i = 0; i < qs.length; i += 1) {
    // The option whose letter badge is exactly "A" (the first option).
    await page
      .locator('button', { has: page.locator('span', { hasText: /^A$/ }) })
      .first()
      .click();
    await page.waitForTimeout(400);
    if (i < qs.length - 1) {
      await page
        .getByRole('button', { name: /^Câu tiếp/ })
        .first()
        .click();
      await page.waitForTimeout(400);
    }
  }
  const submit = page
    .getByRole('button', { name: /Nộp bài|Nộp|Hoàn thành/ })
    .first();
  const canSubmit = await submit
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  check('grammar offers a submit control after the last question', canSubmit);
  if (canSubmit) {
    await submit.click();
    await page.waitForTimeout(4000);
  }
  const [row] = harnessQuery(
    `select a.score from "GrammarAttempt" a join "User" u on u.id = a."userId" where u.email = '${account.email}' order by a.id desc limit 1`,
  );
  const expected = Math.round(
    (qs.filter((q) => q.correct === 0).length / qs.length) * 100,
  );
  check(
    'the attempt was stored with the score computed from the keys',
    row?.[0] === String(expected),
    `(db ${row?.[0]}, expected ${expected})`,
  );
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const correct = qs.filter((q) => q.correct === 0).length;
  check(
    'the result shown matches the stored attempt',
    text.includes(`${correct}/${qs.length} câu đúng`),
    `(looking for ${correct}/${qs.length} câu đúng)`,
  );
  await page.screenshot({
    path: 'artifacts/finalization/evidence/grammar-result.png',
    fullPage: true,
  });
  check('no server error', !issues.some((x) => x.startsWith('api 5')));
  await browser.close();
}

async function flashcard() {
  console.log('\n== Flashcard (browser)');
  const { browser, page, account, issues } = await studentPage('flash-ui');
  await page.goto(`${FE}/flashcard/1`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.waitForTimeout(2000);
  await page
    .getByRole('button', { name: /Đã thuộc/ })
    .first()
    .click();
  await page.waitForTimeout(2500);
  const [row] = harnessQuery(
    `select count(*) from "UserVocabWordProgress" p join "User" u on u.id = p."userId" where u.email = '${account.email}' and p."isMastered" = true`,
  );
  check(
    '"Đã thuộc" persists a mastered word for this learner',
    row?.[0] === '1',
    `(${row?.[0]})`,
  );
  check('no server error', !issues.some((x) => x.startsWith('api 5')));
  await browser.close();
}

async function main() {
  await listening();
  await reading();
  await grammar();
  await flashcard();
  console.log(`\nPRACTICE_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
