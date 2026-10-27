/**
 * TOEIC review flags survive every save path (disposable harness :3101/:3100).
 *
 * API: an answer-only save keeps the flags; an explicit [] clears them; a
 * new array replaces them; invalid, out-of-Part, foreign and post-submit
 * requests fail and leave the flags as they were; parallel saves leave one
 * complete state.
 * Chromium: flag + autosave, Part switch, reload, manual save + restore,
 * rapid edits — the server state ends equal to what the page shows.
 */
import { call, check, failureCount, newStudent } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const keys = new Map(
  harnessQuery(
    `select q."questionNumber", q.id, q."correctIndex" from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = 1`,
  ).map(([n, id, k]) => [Number(n), { id: Number(id), key: Number(k) }]),
);
const id = (n: number) => keys.get(n)!.id;
const otherExamQuestion = Number(
  harnessQuery(
    `select q.id from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" <> 1 limit 1`,
  )[0]?.[0] ?? 0,
);

function flags(attemptId: number) {
  const raw = harnessQuery(
    `select "markedQuestionIds"::text from "ToeicAttempt" where id = ${attemptId}`,
  )[0][0];
  return (JSON.parse(raw) as number[]).slice().sort((a, b) => a - b);
}
const same = (a: number[], b: number[]) =>
  JSON.stringify([...a].sort((x, y) => x - y)) ===
  JSON.stringify([...b].sort((x, y) => x - y));

async function start(token: string, body: Record<string, unknown>) {
  const s = await call('POST', '/toeic/exams/1/attempts', token, body);
  await call('POST', `/toeic/attempts/${s.data.id}/begin`, token, {});
  return s.data.id as number;
}
const save = (token: string, attemptId: number, body: unknown) =>
  call('PATCH', `/toeic/attempts/${attemptId}/answers`, token, body);

async function api() {
  console.log('\n== API');
  const s = await newStudent('toeic-flags-api');
  const a = await start(s.token, { mode: 'PRACTICE' });
  await save(s.token, a, { answers: {}, markedQuestionIds: [id(5)] });
  check('flag Q5', same(flags(a), [id(5)]));
  const r6 = await save(s.token, a, { answers: { [id(6)]: 0 } });
  check(
    'answer-only save (no markedQuestionIds) keeps Q5 flagged',
    r6.status < 300 && same(flags(a), [id(5)]),
    `(${r6.status} ${JSON.stringify(flags(a))})`,
  );
  await save(s.token, a, { answers: {}, markedQuestionIds: [] });
  check('explicit [] clears the flags', flags(a).length === 0);
  await save(s.token, a, { answers: {}, markedQuestionIds: [id(5), id(150)] });
  check(
    'an array replaces the flags (Q5, Q150)',
    same(flags(a), [id(5), id(150)]),
  );
  const kept = flags(a);
  for (const [label, body] of [
    ['unknown question id', { answers: {}, markedQuestionIds: [99999999] }],
    ['not an integer', { answers: {}, markedQuestionIds: ['x'] }],
    ['not an array', { answers: {}, markedQuestionIds: 5 }],
    [
      'question of another exam',
      { answers: {}, markedQuestionIds: [otherExamQuestion] },
    ],
    [
      'valid flags with an invalid answer',
      { answers: { 99999999: 0 }, markedQuestionIds: [id(7)] },
    ],
  ] as const) {
    const r = await save(s.token, a, body);
    check(
      `${label}: 400, flags unchanged`,
      r.status === 400 && same(flags(a), kept),
      `(${r.status})`,
    );
  }
  const other = await newStudent('toeic-flags-other');
  const foreign = await save(other.token, a, {
    answers: {},
    markedQuestionIds: [],
  });
  check(
    'another learner: 403, flags unchanged',
    foreign.status === 403 && same(flags(a), kept),
    `(${foreign.status})`,
  );

  // Parallel saves: the row lock serialises them; the end state is one whole request.
  const sets = Array.from({ length: 8 }, (_, i) => [id(10 + i), id(110 + i)]);
  await Promise.all(
    sets.map((m) => save(s.token, a, { answers: {}, markedQuestionIds: m })),
  );
  const end = flags(a);
  check(
    '8 parallel saves leave exactly one complete flag set',
    sets.some((m) => same(m, end)),
    JSON.stringify(end),
  );

  const bad = await call('PATCH', '/toeic/attempts/abc/answers', s.token, {
    answers: {},
  });
  check(
    'non-numeric attempt id: 400, not 500',
    bad.status === 400,
    `(${bad.status})`,
  );

  // A different-Part practice is refused while one is open, so a new learner.
  const t = await newStudent('toeic-flags-part');
  const p = await start(t.token, { mode: 'PRACTICE', parts: [2] });
  const outPart = await save(t.token, p, {
    answers: {},
    markedQuestionIds: [id(101)],
  });
  check(
    'part practice (Part 2): flag on Part 5 refused (400)',
    outPart.status === 400,
    `(${outPart.status})`,
  );
  const inPart = await save(t.token, p, {
    answers: {},
    markedQuestionIds: [id(7)],
  });
  check(
    'part practice: flag on Part 2 accepted',
    inPart.status < 300 && same(flags(p), [id(7)]),
  );
  await call('POST', `/toeic/attempts/${p}/submit`, t.token, {});
  const afterSubmit = await save(t.token, p, {
    answers: {},
    markedQuestionIds: [],
  });
  check(
    'submitted attempt: 400, flags unchanged',
    afterSubmit.status === 400 && same(flags(p), [id(7)]),
    `(${afterSubmit.status})`,
  );
}

async function browser() {
  console.log('\n== Chromium');
  const { browser, page, account, issues } = await studentPage(
    'toeic-flags-ui',
    1366,
  );
  await hidePet(page);
  const a = await start(account.token, { mode: 'PRACTICE' });
  await page.goto(`${FE}/toeic/attempts/${a}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page
    .locator('article[data-question-id]')
    .first()
    .waitFor({ timeout: 90_000 });
  const badge = (n: number) =>
    page
      .locator(`#q-${n}`)
      .getByRole('button', { name: new RegExp(`^Câu ${n}[.,]`) });
  const answers = () =>
    new Map(
      harnessQuery(
        `select "questionId", "selectedIndex" from "ToeicAttemptAnswer" where "attemptId" = ${a}`,
      ).map(([q, s]) => [Number(q), Number(s)]),
    );
  const settle = () => page.waitForTimeout(2500);

  await badge(5).click();
  await page.locator('#q-6 input[type="radio"]').nth(1).check();
  await settle();
  check(
    'UI: flag Q5 then answer Q6 → server has both',
    same(flags(a), [id(5)]) && answers().get(id(6)) === 1,
    JSON.stringify(flags(a)),
  );

  await page
    .getByRole('tablist', { name: 'Part' })
    .getByRole('tab', { name: 'Part 5' })
    .click();
  await page.locator('#q-101').waitFor({ timeout: 30_000 });
  await badge(101).click();
  await page.locator('#q-102 input[type="radio"]').nth(0).check();
  await settle();
  check(
    'UI: Part switch, flag Q101 → server Q5 + Q101',
    same(flags(a), [id(5), id(101)]),
    JSON.stringify(flags(a)),
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page
    .locator('article[data-question-id]')
    .first()
    .waitFor({ timeout: 90_000 });
  await page
    .getByRole('tablist', { name: 'Part' })
    .getByRole('tab', { name: 'Part 1' })
    .click();
  const q5 = await badge(5).getAttribute('aria-pressed');
  await page
    .getByRole('tablist', { name: 'Part' })
    .getByRole('tab', { name: 'Part 5' })
    .click();
  const q101 = await badge(101).getAttribute('aria-pressed');
  check(
    'UI: after reload Q5 and Q101 show as flagged',
    q5 === 'true' && q101 === 'true',
    `(${q5}, ${q101})`,
  );

  await page
    .locator('aside')
    .getByRole('button', { name: 'Lưu bài làm' })
    .click();
  await settle();
  await badge(101).click(); // unflag
  await page.locator('#q-103 input[type="radio"]').nth(2).check();
  await settle();
  check(
    'UI: unflag Q101 after the checkpoint → server Q5 only',
    same(flags(a), [id(5)]),
    JSON.stringify(flags(a)),
  );
  await page
    .locator('aside')
    .getByRole('button', { name: 'Khôi phục' })
    .click();
  await page
    .locator('[role="dialog"][aria-modal="true"]')
    .getByRole('button', { name: 'Khôi phục', exact: true })
    .click();
  await settle();
  check(
    'UI: "Khôi phục" brings back the checkpoint flags (Q5, Q101) and answers on the server',
    same(flags(a), [id(5), id(101)]) && !answers().has(id(103)),
    `${JSON.stringify(flags(a))} q103=${answers().get(id(103))}`,
  );

  // Rapid edits: answers and flags clicked faster than the autosave delay.
  for (let n = 104; n <= 112; n += 1) {
    await page
      .locator(`#q-${n} input[type="radio"]`)
      .nth(n % 3)
      .check();
    if (n % 2 === 0) await badge(n).click();
  }
  await page.waitForTimeout(5000);
  const uiFlags: number[] = [];
  for (const n of [101, 104, 105, 106, 107, 108, 109, 110, 111, 112])
    if ((await badge(n).getAttribute('aria-pressed')) === 'true')
      uiFlags.push(id(n));
  uiFlags.push(id(5));
  const saved = answers();
  check(
    'UI: after rapid edits the server equals the page (flags and 9 answers)',
    same(flags(a), uiFlags) &&
      [104, 105, 106, 107, 108, 109, 110, 111, 112].every(
        (n) => saved.get(id(n)) === n % 3,
      ),
    `${JSON.stringify(flags(a))} vs ${JSON.stringify(uiFlags.sort((x, y) => x - y))}`,
  );
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api')).join(' | '),
  );
  await browser.close();
}

async function main() {
  await api();
  await browser();
  console.log(`\nTOEIC_FLAGS_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
