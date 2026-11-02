/**
 * The continuous TOEIC exam room in Chromium on the disposable harness.
 *
 *  - S&W: Start, fullscreen, record, retake, marks, reload keeps the clock and
 *    the takes, submit with questions missing, Writing, save and restore, leave,
 *    Start opens a new session, Khôi phục returns to the old one with its draft,
 *    submit, result with grades arriving.
 *  - The clock: each section closes itself at zero and the next one opens.
 *  - 4 Skills: Listening & Reading hands over to Speaking, then Writing.
 *  - Phone width.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/assessment-room-browser.ts <10s.wav> [flow]
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/room`;
const SW_EXAM = 3;
const LR_EXAM = 2;
const FOUR_SKILLS_EXAM = 5;

const micArgs = (wav: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`,
  '--autoplay-policy=no-user-gesture-required',
];

const body = (page: Page) => page.locator('body').innerText();
const fullscreen = (page: Page) =>
  page.evaluate(() => Boolean(document.fullscreenElement));
const clock = async (page: Page) => {
  const text = await page
    .getByRole('timer', { name: 'Thời gian còn lại' })
    .first()
    .innerText();
  const [m, s] = text.split(':').map(Number);
  return m * 60 + s;
};

async function startExam(page: Page, examId: number) {
  await page.goto(`${FE}/exams/${examId}`);
  await hidePet(page);
  await page
    .getByRole('button', { name: 'Bắt đầu làm bài' })
    .click({ timeout: 60_000 });
}

async function record(page: Page, number: number, seconds: number) {
  const row = page.locator(`#question-${number}`);
  await row.getByRole('button', { name: /Thu âm|Thu lại/ }).click();
  await row.getByRole('button', { name: /Dừng/ }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(seconds * 1000);
  await row.getByRole('button', { name: /Dừng/ }).click();
  await row
    .getByText(/Đã lưu bản ghi/)
    .waitFor({ timeout: 40_000 })
    .catch(() => undefined);
}

async function hurry(sql: string) {
  harnessExec(sql);
}

async function speakingAndWriting(wav: string) {
  const { browser, page, account } = await studentPage(
    'room-sw',
    1366,
    false,
    micArgs(wav),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('console:', m.text().slice(0, 400));
  });

  await startExam(page, SW_EXAM);
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  check('one click opens the first question', true);
  check(
    'no section picker is shown',
    !(await body(page)).includes('Mở phần này'),
  );

  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const opening = await clock(page);
  check('Speaking clock starts near 20:00', opening > 1170, String(opening));
  check(
    'the five tabs are there',
    (await page.getByRole('tab').count()) === 5,
    String(await page.getByRole('tab').count()),
  );
  await page.screenshot({ path: `${SHOTS}/2-speaking-room.png` });

  await record(page, 1, 4);
  check(
    'the first recording is saved',
    await page.locator('#question-1').getByText('Đã lưu bản ghi').isVisible(),
  );
  await page.screenshot({ path: `${SHOTS}/3-speaking-recorded.png` });
  await record(page, 1, 4);
  check(
    'one retake is allowed, then none',
    (await page.locator('#question-1').innerText()).includes(
      'hết lượt thu lại',
    ) &&
      (await page
        .locator('#question-1')
        .getByRole('button', { name: /Thu/ })
        .count()) === 0,
  );
  await record(page, 2, 4);
  check('the exam opens in fullscreen', await fullscreen(page));
  check(
    'the panel matches Listening & Reading',
    /Thời gian còn lại[\s\S]*Nộp bài[\s\S]*Khôi phục[\s\S]*Lưu bài làm[\s\S]*đánh dấu review[\s\S]*Câu 1–2/i.test(
      await page.locator('aside').first().innerText(),
    ),
  );
  check(
    'Khôi phục waits while there is nothing to go back to',
    await page.getByRole('button', { name: 'Khôi phục' }).first().isDisabled(),
  );
  await page
    .getByRole('button', { name: 'Câu 2. Bấm để đánh dấu review' })
    .click();
  check(
    'clicking a question number marks it in the panel',
    (await page
      .getByRole('button', { name: 'Câu 2, đã trả lời, đánh dấu review' })
      .count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/3b-speaking-marked.png` });

  await page.getByRole('tab', { name: 'Câu 3–4' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/4-speaking-picture.png` });
  await page.getByRole('tab', { name: 'Câu 8–10' }).click();
  await page.waitForTimeout(800);
  check(
    'questions 8-10 show the shared information beside three questions',
    (await page.locator('[id^="question-"]').count()) === 3,
  );
  await page.screenshot({ path: `${SHOTS}/5-speaking-information.png` });

  const before = await clock(page);
  await page.reload();
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  const after = await clock(page);
  check(
    'reloading keeps the clock running',
    after <= before && after > before - 60,
    `${before} then ${after}`,
  );
  check(
    'reloading keeps the recordings',
    (await page.locator('#question-1').innerText()).includes(
      'hết lượt thu lại',
    ),
  );
  check(
    'reloading keeps the marks',
    (await page
      .getByRole('button', { name: 'Câu 2, đã trả lời, đánh dấu review' })
      .count()) === 1,
  );
  check(
    'a reload drops fullscreen and offers it back',
    (await page.getByRole('button', { name: 'Vào toàn màn hình' }).count()) ===
      1,
  );
  await page.getByRole('button', { name: 'Vào toàn màn hình' }).click();
  await page.waitForTimeout(400);
  check('one click returns to fullscreen', await fullscreen(page));

  await page.getByRole('button', { name: 'Nộp bài' }).first().click();
  const dialog = page.getByRole('dialog');
  check(
    'submit counts answered, missing and marked questions',
    /2\s*Đã trả lời\s*9\s*Chưa trả lời\s*1\s*Đánh dấu review/.test(
      await dialog.innerText(),
    ),
  );
  await page.screenshot({ path: `${SHOTS}/6-speaking-submit.png` });
  await dialog.getByRole('button', { name: 'Xác nhận nộp bài' }).click();
  await page.getByRole('tab', { name: 'Câu 1–5' }).waitFor({ timeout: 40_000 });
  check(
    'Writing follows Speaking, still fullscreen',
    (await body(page)).includes('Đã nộp phần Speaking') &&
      (await fullscreen(page)),
  );

  const links = harnessQuery(
    `select count(*) from "ToeicAssessmentSpeakingSubmission" l join "SpeakingSubmission" s on s.id = l."speakingSubmissionId" where s."userId" = ${account.userId}`,
  )[0]?.[0];
  check(
    'Speaking keeps one recording per answered question',
    links === '2',
    links,
  );

  await page.getByRole('tab', { name: 'Câu 1–5' }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const writingClock = await clock(page);
  check(
    'Writing clock starts near 60:00',
    writingClock > 3570,
    String(writingClock),
  );
  await page.screenshot({ path: `${SHOTS}/8-writing-pictures.png` });
  await page
    .getByLabel('Bài viết câu 1')
    .fill('The two colleagues are reviewing a report at the office.');
  await page.getByRole('tab', { name: 'Câu 6–7' }).click();
  await page.waitForTimeout(600);
  check(
    'an e-mail task shows the e-mail',
    (await page.locator('#question-6').innerText()).length > 80,
  );
  await page.screenshot({ path: `${SHOTS}/9-writing-email.png` });
  await page
    .getByLabel('Bài viết câu 6')
    .fill(
      'Dear team, I can attend the meeting on Friday and will bring the slides.',
    );
  await page.waitForTimeout(700);

  // Lưu bài làm keeps a copy that Khôi phục brings back.
  await page.getByRole('button', { name: 'Lưu bài làm' }).first().click();
  await page
    .getByText(/Bản lưu lúc .* trên máy này/)
    .first()
    .waitFor({ timeout: 10_000 });
  await page.getByLabel('Bài viết câu 6').fill('changed after the save');
  await page.getByRole('button', { name: 'Khôi phục' }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/9b-restore-save.png` });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Khôi phục' })
    .click();
  check(
    'Khôi phục returns the saved text',
    (await page.getByLabel('Bài viết câu 6').inputValue()).startsWith(
      'Dear team',
    ),
  );
  await page.waitForTimeout(700);

  const firstSession = page.url();
  await page.getByRole('button', { name: 'Thoát' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Thoát' }).click();
  await page.waitForURL(/\/exams\/3/, { timeout: 30_000 });
  await page.waitForTimeout(500);
  check('leaving the room leaves fullscreen', !(await fullscreen(page)));
  check(
    'the exam page only offers a start',
    (await page.getByRole('button', { name: 'Tiếp tục làm bài' }).count()) ===
      0,
  );
  await page
    .getByRole('button', { name: 'Bắt đầu làm bài' })
    .click({ timeout: 40_000 });
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  check(
    'Start opens a new session from Speaking at a full clock',
    page.url() !== firstSession && (await clock(page)) > 1170,
    page.url(),
  );
  check(
    'the new session has no recordings of the old one',
    !(await page.locator('#question-1').innerText()).includes('Đã lưu bản ghi'),
  );
  check('the new session is fullscreen too', await fullscreen(page));
  await page.getByRole('button', { name: 'Khôi phục' }).first().click();
  await page.waitForTimeout(300);
  const offer = await page.getByRole('dialog').innerText();
  check(
    'Khôi phục offers the unfinished session and its section',
    offer.includes('Phiên làm dở') &&
      /phần Writing, còn khoảng (5\d|60) phút/.test(offer),
    offer,
  );
  await page.screenshot({ path: `${SHOTS}/9c-restore-session.png` });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Khôi phục' })
    .click();
  await page.getByRole('tab', { name: 'Câu 1–5' }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  check(
    'going back opens the old session with its drafts, clock and fullscreen',
    page.url() === firstSession &&
      (await page.getByLabel('Bài viết câu 1').inputValue()).startsWith(
        'The two colleagues',
      ) &&
      (await clock(page)) < 3600 &&
      (await fullscreen(page)),
    page.url(),
  );
  await page.getByRole('button', { name: 'Câu 8, chưa trả lời' }).click();
  await page.waitForTimeout(600);
  await page
    .getByLabel('Bài viết câu 8')
    .fill(
      Array(60)
        .fill('Working in a team helps people learn from each other every day.')
        .join(' '),
    );
  await page.screenshot({ path: `${SHOTS}/10-writing-essay.png` });
  await page.getByRole('button', { name: 'Nộp bài' }).first().click();
  const submitWriting = page.getByRole('dialog');
  check(
    'Writing submit counts the 5 missing',
    /3\s*Đã trả lời\s*5\s*Chưa trả lời/.test(await submitWriting.innerText()),
  );
  await submitWriting.getByRole('button', { name: 'Xác nhận nộp bài' }).click();
  await page.waitForURL(/\/result$/, { timeout: 40_000 });
  await page.getByText('Kết quả thi').waitFor({ timeout: 30_000 });
  check('the last section ends on the result page', true);
  await page.screenshot({ path: `${SHOTS}/11-result.png` });
  await page.waitForTimeout(15_000);
  const graded = harnessQuery(
    `select count(*) filter (where s.score is not null), count(*) from "ToeicAssessmentWritingSubmission" l join "Submission" s on s.id = l."submissionId" where s."userId" = ${account.userId}`,
  )[0];
  check(
    'the 3 written answers are stored and graded afterwards',
    graded?.[1] === '3' && graded?.[0] === '3',
    JSON.stringify(graded),
  );
  await page.reload();
  await page.getByRole('tab', { name: 'Writing' }).click({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: `${SHOTS}/12-result-writing.png`,
    fullPage: true,
  });
  await page.goto(`${FE}/exams/${SW_EXAM}`);
  await page
    .getByRole('button', { name: 'Bắt đầu làm bài' })
    .waitFor({ timeout: 40_000 });
  check('a finished exam can be started again from its page', true);
  check(
    'no page error in the S&W run',
    errors.length === 0,
    errors.join(' | '),
  );
  await browser.close();
}

async function clockRunsOut(wav: string) {
  const { browser, page, account } = await studentPage(
    'room-clock',
    1366,
    false,
    micArgs(wav),
  );
  await startExam(page, SW_EXAM);
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  await hurry(
    `update "ToeicAssessmentAttemptComponent" c set "startedAt" = now() - interval '19 minutes 54 seconds' from "ToeicAssessmentAttempt" a where a.id = c."assessmentAttemptId" and a."userId" = ${account.userId} and c.status = 'IN_PROGRESS'`,
  );
  await page.reload();
  await page.getByRole('tab', { name: 'Câu 1–5' }).waitFor({ timeout: 40_000 });
  check('Speaking closes itself at zero with nothing recorded', true);
  await page.getByRole('tab', { name: 'Câu 1–5' }).waitFor({ timeout: 60_000 });
  await page.getByLabel('Bài viết câu 1').fill('A man is reading a report.');
  await page.waitForTimeout(700);
  await hurry(
    `update "ToeicAssessmentAttemptComponent" c set "startedAt" = now() - interval '59 minutes 54 seconds' from "ToeicAssessmentAttempt" a where a.id = c."assessmentAttemptId" and a."userId" = ${account.userId} and c.status = 'IN_PROGRESS'`,
  );
  await page.reload();
  await page.waitForURL(/\/result$/, { timeout: 40_000 });
  const stored = harnessQuery(
    `select count(*) from "ToeicAssessmentWritingSubmission" l join "Submission" s on s.id = l."submissionId" where s."userId" = ${account.userId}`,
  )[0]?.[0];
  check(
    'Writing closes itself at zero and keeps the draft',
    stored === '1',
    stored,
  );
  await browser.close();
}

async function fourSkills(wav: string) {
  const { browser, page, account } = await studentPage(
    'room-4s',
    1366,
    true,
    micArgs(wav),
  );
  await startExam(page, FOUR_SKILLS_EXAM);
  await page.waitForURL(/\/toeic\/attempts\//, { timeout: 60_000 });
  await page
    .getByRole('tab', { name: 'Part 1', exact: true })
    .waitFor({ timeout: 60_000 });
  check(
    'Listening & Reading opens in its own room, in fullscreen',
    await fullscreen(page),
  );
  await page.getByRole('button', { name: 'Nộp bài' }).first().click();
  await page.getByRole('button', { name: 'Xác nhận nộp bài' }).click();
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  const text = await body(page);
  check(
    'Speaking follows Listening & Reading with no result page between',
    text.includes('Đã nộp phần Listening & Reading') &&
      page.url().includes('/toeic/assessments/'),
  );
  check(
    'fullscreen carries over from the paper to Speaking',
    await fullscreen(page),
  );
  await page.screenshot({ path: `${SHOTS}/21-after-lr.png` });

  // A new session opens on the paper, and Khôi phục there reaches the old one.
  const oldSession = page.url();
  await page.getByRole('button', { name: 'Thoát' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Thoát' }).click();
  await page.waitForURL(/\/exams\//, { timeout: 30_000 });
  await startExam(page, FOUR_SKILLS_EXAM);
  await page.waitForURL(/\/toeic\/attempts\//, { timeout: 60_000 });
  await page
    .getByRole('tab', { name: 'Part 1', exact: true })
    .waitFor({ timeout: 60_000 });
  check('Start opens a new paper, in fullscreen', await fullscreen(page));
  await page
    .getByRole('button', { name: 'Khôi phục' })
    .first()
    .click({ timeout: 30_000 });
  await page.waitForTimeout(300);
  const offer = await page.getByRole('dialog').innerText();
  check(
    'the paper offers the unfinished session',
    offer.includes('Phiên làm dở') &&
      /phần Speaking, còn khoảng ([1-9]|1\d|20) phút/.test(offer),
    offer,
  );
  await page.screenshot({ path: `${SHOTS}/21b-restore-from-paper.png` });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Khôi phục' })
    .click();
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  check(
    'going back reopens its Speaking section, still fullscreen',
    page.url() === oldSession && (await fullscreen(page)),
    page.url(),
  );

  // The same hand-over when the clock ends the paper.
  const {
    browser: second,
    page: late,
    account: lateAccount,
  } = await studentPage('room-4s-late', 1366, true, micArgs(wav));
  await startExam(late, FOUR_SKILLS_EXAM);
  await late.waitForURL(/\/toeic\/attempts\//, { timeout: 60_000 });
  await late
    .getByRole('tab', { name: 'Part 1', exact: true })
    .waitFor({ timeout: 60_000 });
  await hurry(
    `update "ToeicAttempt" set deadline = now() + interval '4 seconds' where "userId" = ${lateAccount.userId} and status = 'IN_PROGRESS'`,
  );
  await late.reload();
  await late
    .getByRole('tab', { name: 'Câu 1–2' })
    .waitFor({ timeout: 40_000 })
    .catch(async (error) => {
      await late.screenshot({ path: `${SHOTS}/22-clock-stuck.png` });
      console.log('stuck at', late.url(), (await body(late)).slice(0, 300));
      throw error;
    });
  check('the Listening & Reading clock hands over to Speaking', true);
  await second.close();
  void account;
  await browser.close();
}

/** The stand-alone Listening & Reading paper shares its panel with the room. */
async function listeningReading() {
  const { browser, page } = await studentPage('room-lr', 1366);
  await page.goto(`${FE}/exams/${LR_EXAM}`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await hidePet(page);
  await page.locator('input[name="toeic-mode"][value="FULL_TEST"]').check();
  await page.getByRole('button', { name: /chế độ toàn màn hình/ }).click();
  await page.waitForURL(/\/toeic\/attempts\/\d+/, { timeout: 60_000 });
  await page
    .locator('article[data-question-id]')
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  check('the paper opens in fullscreen', await fullscreen(page));
  const aside = page.locator('aside').first();
  check(
    'the shared panel keeps its order and its Parts',
    /Thời gian còn lại[\s\S]*Nộp bài[\s\S]*Khôi phục[\s\S]*Lưu bài làm[\s\S]*đánh dấu review[\s\S]*Part 1[\s\S]*Part 7/i.test(
      await aside.innerText(),
    ),
  );
  check(
    'Khôi phục waits for a save',
    await aside.getByRole('button', { name: 'Khôi phục' }).isDisabled(),
  );
  await page.locator('#q-1 input[type="radio"]').nth(0).check();
  await page.waitForTimeout(1000);
  await aside.getByRole('button', { name: 'Lưu bài làm' }).click();
  await aside.getByText(/Bản lưu lúc/).waitFor({ timeout: 15_000 });
  await page.locator('#q-1 input[type="radio"]').nth(2).check();
  await page.waitForTimeout(1000);
  await aside.getByRole('button', { name: 'Khôi phục' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Khôi phục' })
    .click();
  await page.waitForTimeout(1000);
  check(
    'Khôi phục brings back the saved answer',
    await page.locator('#q-1 input[type="radio"]').nth(0).isChecked(),
  );
  await aside.getByRole('button', { name: 'Nộp bài' }).click();
  await page.getByRole('button', { name: 'Xác nhận nộp bài' }).click();
  await page.waitForURL(/\/toeic\/results\//, { timeout: 60_000 });
  await page.waitForTimeout(800);
  check('the result page is not fullscreen', !(await fullscreen(page)));
  await browser.close();
}

async function phone(wav: string) {
  const { browser, page } = await studentPage(
    'room-phone',
    390,
    false,
    micArgs(wav),
  );
  await startExam(page, SW_EXAM);
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/30-phone-room.png` });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check('no sideways scroll at 390px', overflow <= 0, String(overflow));
  await page.getByRole('button', { name: 'Mở bảng câu hỏi' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/31-phone-drawer.png` });
  await page.getByRole('button', { name: 'Câu 9, chưa trả lời' }).click();
  await page.waitForTimeout(600);
  check(
    'a number in the drawer opens its tab',
    await page.locator('#question-9').isVisible(),
  );
  await page.screenshot({ path: `${SHOTS}/32-phone-information.png` });
  await browser.close();
}

async function preview(wav: string) {
  const { browser, account } = await studentPage(
    'room-preview',
    1366,
    false,
    micArgs(wav),
  );
  harnessExec(`update "User" set role = 'ADMIN' where id = ${account.userId}`);
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
    waitUntil: 'commit',
  });
  await page.goto(`${FE}/admin/exams/${SW_EXAM}/learner-preview`);
  await page.getByRole('tab', { name: 'Câu 1–2' }).waitFor({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Câu 8–10' }).click();
  await page.waitForTimeout(600);
  check(
    'admin preview uses the learner paper',
    (await page.locator('[id^="question-"]').count()) === 3,
  );
  await page.screenshot({ path: `${SHOTS}/40-preview-speaking.png` });
  await page
    .getByRole('button', { name: 'Writing' })
    .or(page.getByRole('tab', { name: 'Writing' }))
    .first()
    .click();
  await page.getByRole('tab', { name: 'Câu 1–5' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/41-preview-writing.png` });
  check('admin preview shows the Writing tabs', true);
  await browser.close();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const wav = process.argv[2];
  const flow = process.argv[3];
  const run = async (name: string, fn: (wav: string) => Promise<void>) => {
    if (flow && flow !== name) return;
    console.log(`--- ${name}`);
    await fn(wav).catch((error) =>
      check(`${name} ran to its end`, false, String(error).slice(0, 400)),
    );
  };
  await run('sw', speakingAndWriting);
  await run('clock', clockRunsOut);
  await run('four', fourSkills);
  await run('lr', listeningReading);
  await run('phone', phone);
  await run('preview', preview);
  console.log(`failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
