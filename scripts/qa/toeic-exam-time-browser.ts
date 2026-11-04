/**
 * Browser checks on the harness (FE :3100, BE :3101): the S&W room shows the
 * whole exam (80:00) with Speaking's own 20 minutes under it, the 4-skill L&R
 * paper shows 200:00, and the manual exam form takes its length from the
 * product and exam type.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/toeic-exam-time-browser.ts
 */
import { chromium, type Page } from 'playwright';
import { check, failureCount, newAdmin } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';

const SW_EXAM = 3;
const FOUR_SKILLS_EXAM = 5;
const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/time`;

const seconds = (text: string) => {
  const [m, s] = text.trim().split(':').map(Number);
  return m * 60 + s;
};
const examClock = async (page: Page) =>
  seconds(
    await page
      .getByRole('timer', { name: 'Thời gian còn lại của đề' })
      .first()
      .innerText({ timeout: 90_000 }),
  );

async function start(page: Page, examId: number) {
  await page.goto(`${FE}/exams/${examId}`);
  await hidePet(page);
  await page
    .getByRole('button', { name: 'Bắt đầu làm bài' })
    .click({ timeout: 60_000 });
}

async function rooms() {
  const { browser, page } = await studentPage('time-ui', 1366, true);
  await start(page, SW_EXAM);
  const sw = await examClock(page);
  check(
    'the S&W room counts the whole 80 minutes',
    sw > 79 * 60 && sw <= 80 * 60,
    String(sw),
  );
  const note = await page
    .getByText(/^Phần Speaking: \d+:\d\d$/)
    .first()
    .innerText();
  check(
    'Speaking shows its own 20 minutes under it',
    seconds(note.split(': ')[1]) > 19 * 60,
    note,
  );
  await page.screenshot({ path: `${SHOTS}-sw-room.png` });

  await start(page, FOUR_SKILLS_EXAM);
  await page.waitForURL(/\/toeic\/attempts\//, { timeout: 90_000 });
  const four = await examClock(page);
  check(
    'the 4-skill L&R paper counts the whole 200 minutes',
    four > 199 * 60 && four <= 200 * 60,
    String(four),
  );
  const lr = await page
    .getByText(/^Phần Listening & Reading: \d+:\d\d$/)
    .first()
    .innerText();
  check(
    'L&R shows its own 120 minutes under it',
    seconds(lr.split(': ')[1]) > 119 * 60,
    lr,
  );
  await page.screenshot({ path: `${SHOTS}-four-lr.png` });
  await browser.close();
}

async function form() {
  const admin = await newAdmin('time-form');
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
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
  await page.goto(`${FE}/admin/exams`);
  await page
    .getByRole('button', { name: 'Tạo thủ công' })
    .click({ timeout: 90_000 });

  const product = page
    .locator('select')
    .filter({ has: page.locator('option[value="TOEIC_SW"]') })
    .last();
  const type = page
    .locator('select')
    .filter({ has: page.locator('option[value="FULL_TEST"]') })
    .last();
  const minutes = page.locator('input[type="number"][max="240"]').first();

  check(
    'an L&R full test starts at 120 minutes, locked',
    (await minutes.inputValue()) === '120' &&
      (await minutes.getAttribute('readonly')) !== null,
  );
  await product.selectOption('TOEIC_SW');
  check('S&W gets 80 minutes', (await minutes.inputValue()) === '80');
  check(
    'S&W offers a full test only',
    (await type.locator('option').count()) === 1,
  );
  await product.selectOption('TOEIC_4_SKILLS');
  check('4 skills get 200 minutes', (await minutes.inputValue()) === '200');
  await product.selectOption('TOEIC_LR');
  await type.selectOption('PRACTICE_BY_PART');
  check(
    'L&R Part 1–4 practice starts at 45 minutes, editable',
    (await minutes.inputValue()) === '45' &&
      (await minutes.getAttribute('readonly')) === null,
  );
  await page
    .locator('select')
    .filter({ has: page.locator('option[value="READING"]') })
    .selectOption('READING');
  check(
    'L&R Part 5–7 practice starts at 75 minutes',
    (await minutes.inputValue()) === '75',
  );
  await page.screenshot({ path: `${SHOTS}-form.png` });
  await browser.close();
}

async function main() {
  await rooms();
  await form();
  console.log(`\nfailures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
