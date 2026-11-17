/**
 * Checkpoint 58 plans page (harness, Chromium 1440): the cards, comparison
 * table and FAQ state the current plan matrix (PlanCard copy as of
 * 2026-11-17) and prices stay unchanged.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-plans-browser.ts
 */
import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';

void (async () => {
  const { browser, page, issues } = await studentPage('cp58-plans', 1440);
  await hidePet(page);
  await page.goto(`${FE}/plans?highlight=pro`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'prices unchanged: 69.000 and 149.000',
    /69\.000/.test(text) && /149\.000/.test(text),
  );
  check(
    'PLUS card: Speaking/Writing Intermediate and dictation Intermediate+, excludes Advanced and TOEIC S&W',
    text.includes('Nói và Viết Trung cấp') &&
      text.includes('Nghe chép Trung cấp trở lên') &&
      text.includes(
        'Không gồm Nói, Viết Nâng cao và đề TOEIC Speaking & Writing, 4 kỹ năng',
      ),
  );
  check(
    'PRO card: Speaking/Writing at every level and the TOEIC S&W and 4-skill tests',
    text.includes('Nói và Viết ở mọi mức, gồm Nâng cao') &&
      text.includes('Đề TOEIC Speaking & Writing và đề 4 kỹ năng'),
  );
  check(
    'no stale claim that PLUS opens Speaking/Writing',
    !text.includes('Thêm bài B1–C1') &&
      !text.includes('bài luyện nói & viết Premium'),
  );
  // The table starts open; only expand it if it was collapsed.
  const collapsed = page.locator('button[aria-expanded="false"]', {
    hasText: 'bảng so sánh',
  });
  if (await collapsed.count()) await collapsed.first().click();
  await page.waitForTimeout(500);
  const table = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'comparison table splits Nghe/Đọc and Nói/Viết rows',
    table.includes('Luyện Nghe và Đọc') && table.includes('Luyện Nói và Viết'),
  );
  check(
    'FAQ answers Plus vs Pro',
    table.includes('Gói Plus và gói Pro khác nhau thế nào?'),
  );
  await page.screenshot({ path: 'artifacts/qa-screens/cp58-plans-1440.png' });
  const crashes = issues.filter((i) => !i.startsWith('console:'));
  check('no page errors or 5xx', crashes.length === 0, crashes.join(' | '));
  await browser.close();
  console.log(`\nCP58_PLANS_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
