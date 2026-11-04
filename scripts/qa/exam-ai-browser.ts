/**
 * The new-exam form, AI exam generation, missing pictures, AI decks and topics
 * and the picture list, in Chromium on the disposable harness with a
 * deterministic AI (scripts/qa/writing-deterministic-server.ts).
 *
 * Usage: HARNESS_DB=<db> QA_EXAM_MODE_FILE=<file> npx ts-node --transpile-only scripts/qa/exam-ai-browser.ts [flow]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

import { call, check, failureCount, newAdmin } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/exam-ai`;
const modeFile = process.env.QA_EXAM_MODE_FILE ?? '';
const setMode = (mode: string) => writeFileSync(modeFile, mode);

async function adminPage(width = 1366) {
  const admin = await newAdmin('ai-admin');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', admin.email);
  await page.fill('input[name="password"]', admin.password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
    waitUntil: 'commit',
  });
  return { browser, page, admin };
}

async function manualForm(page: Page) {
  await page.goto(`${FE}/admin/exams/new`);
  await hidePet(page);
  await page
    .getByRole('region', { name: 'Cấu trúc đề' })
    .waitFor({ timeout: 60_000 });
  const text = await page.locator('#admin-main').innerText();
  check(
    'the form shows the structure of the exam',
    /Listening/.test(text) && /120 phút/.test(text),
  );
  check(
    'the form holds no engineering words',
    !/authoring|source nội bộ|Candidate|Coming soon/i.test(text),
  );
  await page.screenshot({ path: `${SHOTS}/1-form.png` });
  const title = await page.getByLabel('Tên đề *').inputValue();
  check('the form suggests a name', /Đề luyện tập \d+/.test(title), title);
  await page.getByLabel('Độ khó').selectOption('hard');
  await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
  await page.waitForURL(/exam=\d+/, { timeout: 40_000 });
  const row = harnessQuery(
    `select type, difficulty, left(description, 7) from "ToeicExamSet" order by id desc limit 1`,
  )[0];
  check(
    'a manual exam is a full test',
    row?.[0] === 'FULL_TEST' && row?.[1] === 'hard',
    JSON.stringify(row),
  );
  check(
    'a manual exam carries the practice notice',
    row?.[2] === 'Lưu ý: ',
    row?.[2],
  );
}

async function waitForJob(page: Page) {
  await page
    .getByRole('button', { name: /Duyệt đề|Thử lại/ })
    .first()
    .waitFor({ timeout: 240_000 });
}

async function aiExam(page: Page) {
  setMode('broken-part-5');
  await page.goto(`${FE}/admin/exams/new`);
  await page.evaluate(() =>
    sessionStorage.removeItem('breadtrans:admin:toeic-ai-job'),
  );
  await page.reload();
  await page
    .getByRole('region', { name: 'Cấu trúc đề' })
    .waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'AI tạo đề' }).click();
  await page.getByRole('button', { name: /TOEIC 4 kỹ năng/ }).click();
  await page.getByRole('button', { name: 'Tạo bản nháp bằng AI' }).click();
  await waitForJob(page);
  await page.screenshot({ path: `${SHOTS}/2-job-done.png` });
  const job = harnessQuery(
    `select id, status, (select count(*) from jsonb_array_elements("draftSnapshot"->'failedUnits')), (select count(*) from jsonb_array_elements("draftSnapshot"->'lrBatches')) from "AiGenerationJob" order by "createdAt" desc limit 1`,
  )[0];
  check(
    'a broken Part leaves the other Parts generated',
    job?.[1] === 'GENERATED' &&
      Number(job?.[2]) === 10 &&
      Number(job?.[3]) === 27,
    JSON.stringify(job),
  );

  setMode('');
  await page.getByRole('button', { name: 'Duyệt đề' }).click();
  await page
    .getByRole('button', { name: 'Thử lại nhóm chưa hoàn tất' })
    .click({ timeout: 60_000 });
  await page.waitForFunction(
    () => !document.body.innerText.includes('Một số nhóm chưa sinh hoàn tất'),
    undefined,
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
  await page.getByText('Part 7').first().waitFor({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/3-review.png` });
  check(
    'a retry clears the failed groups from the review',
    !(await page.locator('body').innerText()).includes(
      'Một số nhóm chưa sinh hoàn tất',
    ),
  );
  const text = await page.locator('body').innerText();
  check(
    'the review shows the e-mail of a Writing task',
    text.includes('From: Linh Tran'),
  );

  await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
  await page
    .getByRole('button', { name: /Áp dụng \d+ nội dung/ })
    .click({ timeout: 30_000 });
  const confirm = page
    .getByRole('dialog')
    .getByRole('button', { name: /Áp dụng|Xác nhận/ });
  if (await confirm.count()) await confirm.first().click();
  await page.waitForFunction(
    () => /Còn thiếu \d+ ảnh/.test(document.body.innerText),
    undefined,
    { timeout: 240_000 },
  );
  await page.screenshot({ path: `${SHOTS}/4-after-apply.png` });

  await missing(page);
}

async function missing(page: Page) {
  const examId = harnessQuery(
    `select e.id from "Exam" e where e."variantCode" = 'TOEIC_4_SKILLS' and e."aiGenerationJobId" is not null order by e.id desc limit 1`,
  )[0]?.[0];
  const notified = harnessQuery(
    `select count(*) from "Notification" where type = 'ADMIN_EXAM_MEDIA'`,
  )[0]?.[0];
  check(
    'the admin is notified of the missing pictures',
    Number(notified) >= 1,
    notified,
  );
  const questions = harnessQuery(
    `select count(*), count(*) filter (where cardinality(array(select jsonb_array_elements(q.options))) >= 3) from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" join "ToeicExamSet" s on s.id = g."examId" where s."examId" = ${examId}`,
  )[0];
  check(
    'without pictures the exam still holds all 200 questions',
    questions?.[0] === '200' && questions?.[1] === '200',
    JSON.stringify(questions),
  );

  await page.goto(`${FE}/admin/exams?exam=${examId}`);
  const list = page.getByRole('region', { name: 'Ảnh còn thiếu' });
  await list.waitFor({ timeout: 60_000 });
  const listed = await list.locator('li').count();
  const filled = harnessQuery(
    `select count(*) from "ToeicQuestionGroup" g join "ToeicExamSet" s on s.id = g."examId" where s."examId" = ${examId} and g.part = 1 and g."imageUrl" is not null`,
  )[0]?.[0];
  check(
    'every empty picture slot is listed',
    listed === 13 - Number(filled),
    `${listed} listed, ${filled} filled`,
  );
  check(
    'each slot says what the picture shows',
    (await list.innerText()).includes('Two people at a desk'),
  );
  await page.screenshot({ path: `${SHOTS}/5-missing.png` });

  await list.getByRole('button', { name: /Speaking câu 3/ }).click();
  await page.waitForTimeout(1000);
  harnessExec(
    `update "ToeicQuestionGroup" g set "imageUrl" = 'https://example.test/a.jpg' from "ToeicExamSet" s where g."examId" = s.id and s."examId" = ${examId} and g.part = 1 and g.id = (select min(x.id) from "ToeicQuestionGroup" x where x."examId" = s.id and x.part = 1 and x."imageUrl" is null)`,
  );
  await page.reload();
  await list.waitFor({ timeout: 60_000 });
  const refilled = harnessQuery(
    `select count(*) from "ToeicQuestionGroup" g join "ToeicExamSet" s on s.id = g."examId" where s."examId" = ${examId} and g.part = 1 and g."imageUrl" is not null`,
  )[0]?.[0];
  check(
    'a filled picture leaves the list',
    (await list.locator('li').count()) === 13 - Number(refilled),
    String(await list.locator('li').count()),
  );

  await page.goto(`${FE}/admin/exams/${examId}/learner-preview`);
  await page
    .getByRole('tab', { name: 'Part 3', exact: true })
    .click({ timeout: 60_000 });
  await page
    .getByRole('figure')
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => undefined);
  const graphics = await page.locator('figure').count();
  check('Part 3 shows its three graphics', graphics === 3, String(graphics));
  await page
    .locator('figure')
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);
  await page.screenshot({ path: `${SHOTS}/6-graphic.png` });
  await page.getByRole('tab', { name: 'Part 7', exact: true }).click();
  await page.waitForTimeout(800);
  const documents =
    (await page.locator('body').innerText()).match(/DOCUMENT 3/gi)?.length ?? 0;
  check(
    'Part 7 shows three triple passages',
    documents === 3,
    String(documents),
  );
}

async function standIn(page: Page) {
  setMode('quota');
  await page.goto(`${FE}/admin/exams/new`);
  await page.evaluate(() =>
    sessionStorage.removeItem('breadtrans:admin:toeic-ai-job'),
  );
  await page.reload();
  await page
    .getByRole('region', { name: 'Cấu trúc đề' })
    .waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'AI tạo đề' }).click();
  await page.getByLabel('Chế độ tạo').selectOption('PART');
  await page
    .locator('select', { has: page.locator('option', { hasText: 'Part 7' }) })
    .selectOption('7');
  await page.getByRole('button', { name: 'Tạo bản nháp bằng AI' }).click();
  await waitForJob(page);
  await page.getByRole('button', { name: 'Duyệt đề' }).click();
  await page
    .getByRole('button', { name: 'Tất cả', exact: true })
    .click({ timeout: 60_000 });
  await page
    .getByText('Sinh bằng nguồn dự phòng')
    .first()
    .waitFor({ timeout: 60_000 });
  check(
    'when Gemini is out of quota the stand-in writes the Part, and it says so',
    true,
  );
  await page.screenshot({ path: `${SHOTS}/7-stand-in.png` });
  setMode('');
}

let adminToken = '';

/** Starts one L&R Part job through the API and waits for it to settle. */
async function partJob(part: number, mode: string) {
  setMode(mode);
  const started = await call('POST', '/admin/exams/ai/generate', adminToken, {
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_LR',
    mode: 'PART',
    part,
    difficulty: 'medium',
  });
  const id: string = started.data?.id;
  for (let i = 0; i < 180; i += 1) {
    const status = await call('GET', `/admin/exams/ai/jobs/${id}`, adminToken);
    if (
      ['GENERATED', 'FAILED'].includes(status.data?.status) ||
      status.data?.stage === 'WAITING_QUOTA'
    )
      return { id, status: status.data };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`job ${id} did not settle`);
}

const snapshotRow = (id: string) =>
  harnessQuery(
    `select (select count(*) from jsonb_array_elements("draftSnapshot"->'lrBatches')), coalesce("draftSnapshot"->'lrBatches'->0->'candidate'->'groups'->0->>'passageText', "draftSnapshot"->'lrBatches'->0->'candidate'->'groups'->0->'questions'->0->>'text'), (select count(*) from jsonb_array_elements("draftSnapshot"->'failedUnits') u where u->>'code' = 'ANSWER_REVIEW_FAILED') from "AiGenerationJob" where id = '${id}'`,
  )[0];

async function openWorkspace(page: Page, id: string) {
  await page.goto(`${FE}/admin/exams/ai/${id}`);
  await page
    .getByRole('button', { name: 'Tất cả', exact: true })
    .click({ timeout: 60_000 });
  await page
    .getByRole('region', { name: 'Kiểm định đáp án' })
    .first()
    .waitFor({ timeout: 60_000 });
  return page.locator('body').innerText();
}

/** The answer review: refusal, independent, degraded, outage and resume. */
async function review(page: Page) {
  const refused = await partJob(5, 'review-disagree-part-5');
  check(
    'a disagreeing reviewer keeps every Part 5 batch as refused',
    refused.status.status === 'GENERATED' &&
      Number(snapshotRow(refused.id)?.[2]) === 10,
    JSON.stringify(snapshotRow(refused.id)),
  );
  let text = await openWorkspace(page, refused.id);
  check('a refused group says so', text.includes('Bị bác bỏ'));
  check(
    'it names the disagreement',
    text.includes('Người giải độc lập chọn đáp án khác'),
  );
  check(
    'the answer line names the provider and model that answered',
    text.includes('Đáp án: kiểm định độc lập bởi Cloudflare gpt-oss-120b'),
  );
  await page.screenshot({
    path: `${SHOTS}/review-1-refused.png`,
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
  await page.getByRole('button', { name: /Áp dụng \d+ nội dung/ }).click();
  await page
    .getByRole('region', { name: 'Nhóm chưa được áp dụng' })
    .waitFor({ timeout: 60_000 });
  text = await page.locator('body').innerText();
  check(
    'Apply holds the refused groups back and says why',
    text.includes('bị bác bỏ'),
  );
  const written = harnessQuery(
    `select count(*) from "ToeicQuestionGroup" g join "ToeicExamSet" s on s.id = g."examId" join "Exam" e on e.id = s."examId" where e."aiGenerationJobId" = '${refused.id}'`,
  )[0]?.[0];
  check('no refused group reaches the Draft', written === '0', written);
  await page.screenshot({ path: `${SHOTS}/review-2-skipped.png` });

  const good = await partJob(6, '');
  text = await openWorkspace(page, good.id);
  check(
    'an agreeing review is independent for the answer',
    text.includes('Đáp án đã kiểm định độc lập') &&
      text.includes('Đáp án: kiểm định độc lập bởi Cloudflare gpt-oss-120b'),
  );
  check(
    'the explanation line says it came from the same vendor',
    text.includes(
      'Giải thích: kiểm tra bởi Gemini gemini-qa, cùng hãng với model sinh đề',
    ),
  );
  await page.screenshot({ path: `${SHOTS}/review-3-independent.png` });

  const degraded = await partJob(6, 'review-cloudflare-down');
  text = await openWorkspace(page, degraded.id);
  check(
    'a Gemini fallback is degraded and needs the admin',
    text.includes('Kiểm định cùng hãng, cần admin xác nhận') &&
      text.includes(
        'Đáp án: kiểm tra bởi Gemini gemini-qa, cùng hãng với model sinh đề, cần admin xác nhận',
      ),
  );
  await page
    .getByRole('button', { name: 'Xác nhận sau kiểm định cùng hãng' })
    .first()
    .click();
  await page
    .getByText('Admin đã xác nhận')
    .first()
    .waitFor({ timeout: 30_000 });
  check('the admin confirms a degraded group', true);
  await page.screenshot({ path: `${SHOTS}/review-4-confirmed.png` });

  const stopped = await partJob(6, 'review-outage');
  const before = snapshotRow(stopped.id);
  // Every reviewer out: the job waits (no reset known: 30 minutes) with the
  // batch saved, instead of failing; "retry" runs it now.
  const waitMinutes =
    (Date.parse(stopped.status.resumeAt ?? '') - Date.now()) / 60_000;
  check(
    'a reviewer outage makes the job wait for the AI quota with the batch saved',
    stopped.status.status === 'QUEUED' &&
      stopped.status.stage === 'WAITING_QUOTA' &&
      waitMinutes > 25 &&
      waitMinutes <= 30 &&
      /Kiểm định đáp án tạm thời không khả dụng/.test(
        stopped.status.error ?? '',
      ) &&
      before?.[0] === '1',
    `${stopped.status.status} ${stopped.status.stage} ${stopped.status.resumeAt} ${JSON.stringify(before)}`,
  );
  setMode('');
  await call('POST', `/admin/exams/ai/jobs/${stopped.id}/retry`, adminToken);
  let resumed: any;
  for (let i = 0; i < 120; i += 1) {
    resumed = await call(
      'GET',
      `/admin/exams/ai/jobs/${stopped.id}`,
      adminToken,
    );
    if (['GENERATED', 'FAILED'].includes(resumed.data?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const after = snapshotRow(stopped.id);
  check(
    'the resumed job reviews the saved batch without redrafting it',
    resumed.data?.status === 'GENERATED' &&
      after?.[0] === '2' &&
      after?.[1] === before?.[1],
    `${resumed.data?.status} ${JSON.stringify(after)}`,
  );
  setMode('');
}

async function aiDecks(page: Page) {
  await page.goto(`${FE}/admin/vocab`);
  await page
    .getByRole('button', { name: 'Tạo bằng AI' })
    .click({ timeout: 60_000 });
  await page.getByLabel('Chủ đề của bộ từ').fill('Từ vựng họp hành QA');
  await page.screenshot({ path: `${SHOTS}/8-vocab-dialog.png` });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Tạo bằng AI' })
    .click();
  await page.waitForURL(/\/admin\/vocab\/\d+/, { timeout: 60_000 });
  await page.getByText('qaword14').waitFor({ timeout: 60_000 });
  check('AI opens a new deck with its suggestions', true);
  await page.screenshot({ path: `${SHOTS}/9-vocab-words.png` });

  await page.goto(`${FE}/admin/grammar`);
  await page
    .getByRole('button', { name: 'Tạo bằng AI' })
    .click({ timeout: 60_000 });
  await page.getByLabel('Tên chủ đề').fill('Câu điều kiện QA');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Tạo bằng AI' })
    .click();
  await page.waitForURL(/\/admin\/grammar\/\d+/, { timeout: 60_000 });
  await page
    .getByText(/câu hỏi|Gợi ý lại/)
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  check(
    'AI opens a new topic with its draft',
    (await page.locator('body').innerText()).includes('Gợi ý lại'),
  );
  await page.screenshot({ path: `${SHOTS}/10-grammar.png` });
}

async function pictures(page: Page) {
  await page.goto(`${FE}/admin/writing`);
  await page
    .getByRole('tab', { name: 'Viết câu theo tranh' })
    .click({ timeout: 60_000 });
  const section = page.getByRole('region', { name: 'Viết câu theo tranh' });
  await section.getByRole('listitem').first().waitFor({ timeout: 60_000 });
  const admin = await section.getByRole('listitem').count();
  await page.screenshot({ path: `${SHOTS}/11-pictures.png` });
  check('the admin list has one card per picture', admin === 10, String(admin));
  check(
    'it says how many learners see',
    (await section.innerText()).includes('học viên thấy 10 tranh'),
  );
  const topics = await call('GET', '/writing/topics');
  const learner = (topics.data.quizzes as any[])
    .filter((quiz) => quiz.taskType === 'PICTURE_SENTENCE')
    .flatMap((quiz) => quiz.pictureTasks ?? [])
    .filter((task) => task.imageUrl && task.keywords.length === 2).length;
  check(
    'the learner list matches',
    learner === admin,
    `${learner} of ${admin}`,
  );
}

/** An exam can be taken again from its page; results stay in the statistics. */
async function retake() {
  const { browser, page, account } = await studentPage(
    'ai-retake',
    1366,
    false,
    ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  );
  const first = await call(
    'POST',
    '/toeic/assessments/1/attempts',
    account.token,
    {},
  );
  for (const component of first.data.components) {
    const base = `/toeic/assessments/attempts/${first.data.id}/components/${component.assessmentComponentId}`;
    await call('POST', `${base}/start`, account.token);
    await call('POST', `${base}/complete`, account.token, {});
  }
  await page.goto(`${FE}/exams/3`);
  const start = page.getByRole('button', { name: 'Bắt đầu làm bài' });
  await start.waitFor({ timeout: 60_000 });
  check(
    'a finished exam offers the exam again',
    (await page.getByRole('button', { name: 'Xem kết quả' }).count()) === 0,
  );
  await page.screenshot({ path: `${SHOTS}/13-retake.png` });
  await start.click();
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  check(
    'taking it again opens a new attempt',
    !page.url().endsWith(`/${first.data.id}`),
    page.url(),
  );
  await page.goto(`${FE}/toeic/stats`);
  await page.getByText('Xem chi tiết').first().waitFor({ timeout: 60_000 });
  check('the finished attempt stays in the statistics', true);
  await browser.close();
}

async function phone() {
  const { browser, page } = await adminPage(390);
  for (const [path, label] of [
    ['/admin/exams/new', 'form'],
    ['/admin/writing', 'writing'],
    ['/admin/vocab', 'vocab'],
    ['/admin/grammar', 'grammar'],
  ]) {
    await page.goto(`${FE}${path}`);
    await page.waitForTimeout(3500);
    if (label === 'writing')
      await page
        .getByRole('tab', { name: 'Viết câu theo tranh' })
        .click({ timeout: 60_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/phone-${label}.png` });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    check(
      `no sideways scroll on ${path} at 390px`,
      overflow <= 0,
      String(overflow),
    );
  }
  await browser.close();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  setMode('');
  const flow = process.argv[2];
  const { browser, page, admin } = await adminPage();
  adminToken = admin.token;
  const run = async (name: string, fn: (page: Page) => Promise<void>) => {
    if (flow && flow !== name) return;
    console.log(`--- ${name}`);
    await fn(page).catch(async (error) => {
      await page
        .screenshot({ path: `${SHOTS}/failed-${name}.png` })
        .catch(() => undefined);
      check(`${name} ran to its end`, false, String(error).slice(0, 400));
    });
  };
  await run('form', manualForm);
  await run('exam', aiExam);
  if (flow === 'missing') await run('missing', missing);
  await run('review', review);
  await run('standin', standIn);
  await run('decks', aiDecks);
  await run('pictures', pictures);
  await run('retake', retake);
  if (flow === 'phone') await run('phone', phone);
  await browser.close();
  console.log(`failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
