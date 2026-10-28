/**
 * Checkpoint 58: owner app (:3000) Grammar catalog as the QA FREE learner,
 * at 1366 and 1440. Read-only: it opens the catalog, switches tabs and lets
 * "Luyện ngẫu nhiên" open a topic, but never submits an attempt.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-grammar-owner-browser.ts
 */
import { chromium } from 'playwright';

const FE = 'http://localhost:3000';

void (async () => {
  let fails = 0;
  const check = (n: string, ok: boolean, d = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
  };
  const browser = await chromium.launch();
  for (const width of [1366, 1440]) {
    console.log(`\n== ${width}px`);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    const writes: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes(':3001') && r.status() >= 500)
        errors.push(`${r.status()} ${r.url()}`);
    });
    page.on('request', (r) => {
      if (/\/grammar\/topics\/\d+\/attempt/.test(r.url())) writes.push(r.url());
    });
    await page.goto(`${FE}/login`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.click('button[aria-controls="email-login-panel"]');
    await page.fill('input[name="email"]', 'qa-cp51-free@breadtrans.local');
    await page.fill('input[name="password"]', 'Cp51-Free-Qa-2026!');
    await page.click('#email-login-panel button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 60_000,
    });
    // The legacy /grammar route still lands on the grammar catalog.
    await page.goto(`${FE}/grammar`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(2000);
    await page
      .addStyleTag({
        content:
          '[data-companion-pet], [aria-label*="thú cưng" i] { display:none !important }',
      })
      .catch(() => undefined);

    const sectionSel = 'section[aria-labelledby^="grammar-"]';
    const sections = await page.locator(`${sectionSel} h2`).allInnerTexts();
    check(
      'sections Từ loại, Động từ, Ngữ pháp khác',
      sections.join('|') === 'Từ loại|Động từ|Ngữ pháp khác',
      sections.join('|'),
    );
    const cards = page.locator(`${sectionSel} article`);
    check('12 published topics', (await cards.count()) === 12);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check(
      'DRAFT topics 1/2 absent (their replacements 13/14 present)',
      (await cards
        .filter({ hasText: 'Past Simple & Time Expressions' })
        .count()) === 1 && !/Mở khóa với PLUS|Mở khóa với PRO/.test(body),
    );
    const verbs = await page
      .locator('section[aria-labelledby="grammar-VERB"] article h3')
      .allInnerTexts();
    check(
      'replacements 13/14 lead the verb section',
      verbs[0] === 'Thì hiện tại đơn và trạng từ tần suất' &&
        verbs[1] === 'Thì quá khứ đơn và trạng từ thời gian',
      verbs.slice(0, 2).join(' | '),
    );
    const counts = await page
      .locator(`${sectionSel} > div > span`)
      .allInnerTexts();
    check(
      'section counts come from the data (2/10, 7/35, 3/15)',
      counts.join('|') ===
        '2 chủ đề · 10 câu hỏi|7 chủ đề · 35 câu hỏi|3 chủ đề · 15 câu hỏi',
      counts.join('|'),
    );
    const tabs = page.getByRole('group', { name: 'Phân loại ngữ pháp' });
    await tabs.getByRole('button', { name: /^Động từ/ }).click();
    check('"Động từ" tab shows its 7 topics', (await cards.count()) === 7);
    await tabs.getByRole('button', { name: /^Tất cả/ }).click();
    await page.screenshot({
      path: `artifacts/qa-screens/cp58-owner-grammar-${width}.png`,
    });
    check(
      'the random button explains it opens one topic',
      (await page.locator('#grammar-random-hint').innerText()).includes(
        'Mở một chủ đề ngẫu nhiên',
      ),
    );
    await page.getByRole('button', { name: 'Luyện ngẫu nhiên' }).click();
    await page.waitForTimeout(3000);
    const opened = (await page.locator('body').innerText()).replace(
      /\s+/g,
      ' ',
    );
    check(
      '"Luyện ngẫu nhiên" opens a real topic (Vietnamese title shown)',
      (await cards.count()) === 0 &&
        /Thì |Câu |Mệnh đề|So sánh|Danh động từ|Từ nối|Các loại từ|Động từ khuyết|Các cách diễn đạt/.test(
          opened,
        ),
      opened.slice(0, 140),
    );
    check('no attempt submitted', writes.length === 0, writes.join(' '));
    check('no 5xx', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log(`\nCP58_OWNER_GRAMMAR_FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
