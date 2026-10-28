/**
 * Checkpoint 58 owner app (:3000 / :3001, kltn_db) acceptance of "Viết câu
 * theo tranh" after the authorized deployment, as FREE, PLUS and PRO learners
 * in desktop Chromium. Read-only: it opens catalogs and workspaces, types in
 * the editor to check the 40-word limit, but never grades; any non-GET API
 * request other than login is reported as a failure.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-owner-picture-browser.ts
 */
import { chromium, type Page } from 'playwright';

const FE = 'http://localhost:3000';
const ACCOUNTS: Array<[string, string, string, number]> = [
  ['FREE', 'qa-cp51-free@breadtrans.local', 'Cp51-Free-Qa-2026!', 1366],
  ['FREE', 'qa-cp51-free@breadtrans.local', 'Cp51-Free-Qa-2026!', 1440],
  ['PLUS', 'student3@breadtrans.com', 'Password123!', 1440],
  ['PRO', 'student2@breadtrans.com', 'Password123!', 1440],
];

let fails = 0;
const check = (n: string, ok: boolean, d = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
};

async function login(page: Page, email: string, password: string) {
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 120_000,
  });
}

void (async () => {
  const browser = await chromium.launch();
  for (const [plan, email, password, width] of ACCOUNTS) {
    console.log(`\n== ${plan} ${width}px`);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('request', (r) => {
      if (
        r.url().includes(':3001') &&
        r.method() !== 'GET' &&
        r.method() !== 'OPTIONS' &&
        !/\/auth\/(login|refresh)/.test(r.url())
      )
        writes.push(`${r.method()} ${r.url().replace(/^.*:3001/, '')}`);
    });
    page.on('response', (r) => {
      if (r.url().includes(':3001') && r.status() >= 500)
        errors.push(`${r.status()} ${r.url()}`);
    });
    await login(page, email, password);
    await page
      .addStyleTag({
        content:
          '[data-companion-pet], [aria-label*="thú cưng" i] { display:none !important }',
      })
      .catch(() => undefined);

    await page.goto(`${FE}/writing`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(2000);
    const practiceCount = Number(
      (await page.getByTestId('catalog-result-count').innerText()).match(
        /\d+/,
      )?.[0],
    );
    check(
      'existing Writing practice tab still lists its 6 exercises',
      practiceCount === 6,
      `(${practiceCount})`,
    );
    const tab = page.getByRole('tab', { name: 'Viết câu theo tranh' });
    check('"Viết câu theo tranh" tab visible', await tab.isVisible());
    await tab.click();
    await page.waitForTimeout(2500);
    const cards = page.locator('article');
    check('10 picture cards', (await cards.count()) === 10);
    const loaded = await page
      .locator('article img')
      .evaluateAll((imgs) =>
        imgs.filter(
          (i) =>
            (i as HTMLImageElement).complete &&
            (i as HTMLImageElement).naturalWidth > 0,
        ),
      );
    // Lazy images below the fold load once scrolled into view.
    if (loaded.length < 10) {
      for (const card of await cards.all()) await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(2500);
    }
    const loadedAll = await page
      .locator('article img')
      .evaluateAll(
        (imgs) =>
          imgs.filter(
            (i) =>
              (i as HTMLImageElement).complete &&
              (i as HTMLImageElement).naturalWidth > 0,
          ).length,
      );
    check('all 10 pictures load', loadedAll === 10, `(${loadedAll})`);
    const texts = (await cards.allInnerTexts()).map((t) =>
      t.replace(/\s+/g, ' '),
    );
    const a2 = texts.filter((t) => t.includes('Cơ bản · A2'));
    const b1 = texts.filter((t) => t.includes('Trung cấp · B1'));
    check('5 A2 and 5 B1 cards', a2.length === 5 && b1.length === 5);
    const pairs = [
      'cashier scan',
      'order counter',
      'carry boxes',
      'waiter table',
      'suitcase board',
      'presentation chart',
      'file shelf',
      'plan site',
      'ladder replace',
      'bicycle entrance',
    ];
    check(
      'every card shows its two cue words',
      pairs.every((p) => texts.some((t) => t.includes(p))),
    );
    const b1Locked = plan !== 'PRO';
    check(
      `A2 "Luyện viết" ×5; B1 ${b1Locked ? '"Mở khóa với PRO" ×5' : '"Luyện viết" ×5'}`,
      a2.every((t) => t.includes('Luyện viết')) &&
        b1.every((t) =>
          b1Locked ? t.includes('Mở khóa với PRO') : t.includes('Luyện viết'),
        ),
    );
    check(
      'no PLUS offer and no plan badge above the cards',
      !texts.some((t) => t.includes('Mở khóa với PLUS')) &&
        !texts.some((t) => /^(PRO|PLUS)\b/.test(t)),
    );
    await page.screenshot({
      path: `artifacts/qa-screens/cp58-owner-picture-${plan}-${width}.png`,
    });

    if (b1Locked) {
      await cards
        .filter({ hasText: 'Mở khóa với PRO' })
        .first()
        .getByRole('button')
        .click();
      const dialog = page.locator('[aria-labelledby="paywall-title"]');
      await dialog.waitFor({ timeout: 10_000 });
      check(
        'locked B1 card offers PRO',
        (await dialog.innerText()).includes('Xem gói PRO'),
      );
      await dialog.getByRole('button', { name: 'Để sau' }).click();
    }

    // Workspace (no grading)
    const target = b1Locked ? 'Cơ bản · A2' : 'Trung cấp · B1';
    await cards
      .filter({ hasText: target })
      .first()
      .getByRole('button', { name: /^Luyện viết/ })
      .click();
    await page.waitForURL(/\/writing\/4[56]\?q=\d+/, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const left = await page
      .getByRole('region', { name: 'Tranh và từ gợi ý' })
      .boundingBox();
    const right = await page
      .getByRole('region', { name: 'Bài viết của bạn' })
      .boundingBox();
    check(
      'workspace: picture left, editor right',
      !!left && !!right && left.x < right.x && Math.abs(left.y - right.y) < 40,
    );
    const img = page.locator('section[aria-label="Tranh và từ gợi ý"] img');
    check(
      'workspace picture loads',
      await img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    );
    const guide = (
      await page.getByRole('region', { name: 'Bài viết của bạn' }).innerText()
    ).replace(/\s+/g, ' ');
    check(
      b1Locked
        ? 'A2 instructions: one or two sentences, 40 words'
        : 'B1 instructions: ONE sentence with a connector, 40 words',
      b1Locked
        ? guide.includes('một hoặc hai câu') && guide.includes('Tối đa 40 từ')
        : guide.includes('MỘT câu') &&
            guide.includes('từ nối') &&
            guide.includes('Tối đa 40 từ'),
    );
    const grade = page.getByRole('button', { name: 'Chấm bài' });
    check('"Chấm bài" disabled while empty', await grade.isDisabled());
    await page
      .locator('#picture-answer')
      .fill(`The picture shows ${'many '.repeat(37)}things.`);
    check(
      '41 words: counter warns, "Chấm bài" disabled',
      (await page.locator('#picture-word-count').innerText()).includes(
        '41/40',
      ) && (await grade.isDisabled()),
    );
    await page.locator('#picture-answer').fill('');
    const nav = page.getByRole('navigation', { name: 'Các tranh trong bài' });
    const before = page.url();
    await nav.getByRole('button', { name: /^Tranh 2/ }).click();
    await page.waitForTimeout(1500);
    check(
      'navigation to picture 2 changes the task',
      page.url() !== before && /q=\d+/.test(page.url()),
    );
    if (b1Locked) {
      await page.goto(`${FE}/writing/46`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      });
      await page.waitForTimeout(2000);
      const body = (await page.locator('body').innerText()).replace(
        /\s+/g,
        ' ',
      );
      check(
        `${plan} opening B1 directly: "Nội dung dành cho PRO"`,
        body.includes('Nội dung dành cho PRO'),
      );
    }
    check('no write request', writes.length === 0, writes.join(' | '));
    check('no 5xx', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log(`\nCP58_OWNER_PICTURE_FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
