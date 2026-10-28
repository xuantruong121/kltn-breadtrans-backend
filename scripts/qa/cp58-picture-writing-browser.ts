/**
 * Checkpoint 58 "Viết câu theo tranh" in Chromium (harness, 1366 and 1440):
 * the tab, the picture catalog and its filters, the two-column workspace,
 * the 40-word limit, grading with the result beside the editor (mock
 * grader), and the PRO lock on B1 pictures for FREE and PLUS learners.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-picture-writing-browser.ts
 */
import { call, check, failureCount, newAdmin } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const one = (sql: string) => harnessQuery(sql)[0]?.[0];
const B1 = Number(
  one(
    `select id from "Quiz" where title = 'Viết câu theo tranh: nơi làm việc (B1)'`,
  ),
);

void (async () => {
  for (const width of [1366, 1440]) {
    console.log(`\n== ${width}px`);
    const { browser, page, issues } = await studentPage(
      `cp58-picture-${width}`,
      width,
    );
    await hidePet(page);
    await page.goto(`${FE}/writing`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(1500);
    const tab = page.getByRole('tab', { name: 'Viết câu theo tranh' });
    check('the picture tab is shown', await tab.isVisible());
    await tab.click();
    await page.waitForTimeout(800);
    const cards = page.locator('article');
    check('10 picture cards', (await cards.count()) === 10);
    check(
      'A2 pictures open with "Luyện viết", B1 pictures say "Mở khóa với PRO"',
      (await page.getByRole('button', { name: /^Luyện viết/ }).count()) === 5 &&
        (await cards.filter({ hasText: 'Mở khóa với PRO' }).count()) === 5 &&
        (await cards.filter({ hasText: 'Mở khóa với PLUS' }).count()) === 0,
    );
    const first = (await cards.first().innerText()).replace(/\s+/g, ' ');
    check(
      'Dễ → Khó: the first card is Cơ bản with two cue words',
      first.includes('Cơ bản · A2'),
      first.slice(0, 80),
    );
    const pairs = await page.locator('#picture-pair option').count();
    check('pair filter lists the 10 real pairs', pairs === 11, `(${pairs})`);
    await page.selectOption('#picture-pair', 'order / counter');
    await page.waitForTimeout(300);
    check('a pair shows its one picture', (await cards.count()) === 1);
    await page
      .getByRole('button', { name: 'Đặt lại tất cả bộ lọc về mặc định' })
      .click();
    await page
      .getByRole('group', { name: 'Lọc theo độ khó' })
      .getByRole('button', { name: 'Trung cấp' })
      .click();
    await page.waitForTimeout(300);
    check(
      'Trung cấp shows the five locked B1 pictures',
      (await cards.count()) === 5 &&
        (await cards.filter({ hasText: 'Mở khóa với PRO' }).count()) === 5,
    );
    await page
      .getByRole('button', { name: 'Đặt lại tất cả bộ lọc về mặc định' })
      .click();
    await cards
      .filter({ hasText: 'Mở khóa với PRO' })
      .first()
      .getByRole('button')
      .click();
    const dialog = page.locator('[aria-labelledby="paywall-title"]');
    await dialog.waitFor({ timeout: 10_000 });
    check(
      'a locked picture offers PRO',
      (await dialog.innerText()).includes('Xem gói PRO'),
    );
    await dialog.getByRole('button', { name: 'Để sau' }).click();
    if (width === 1366)
      await page.screenshot({
        path: 'artifacts/qa-screens/cp58-picture-catalog-1366.png',
      });

    // Workspace
    await page
      .getByRole('button', { name: /^Luyện viết/ })
      .first()
      .click();
    await page.waitForURL(/\/writing\/\d+\?q=\d+/, { timeout: 60_000 });
    await page.waitForTimeout(2000);
    const pictureBox = await page
      .getByRole('region', { name: 'Tranh và từ gợi ý' })
      .boundingBox();
    const answerBox = await page
      .getByRole('region', { name: 'Bài viết của bạn' })
      .boundingBox();
    check(
      'two columns: picture left, editor right',
      !!pictureBox &&
        !!answerBox &&
        pictureBox.x < answerBox.x &&
        Math.abs(pictureBox.y - answerBox.y) < 40,
    );
    const img = page.locator('section[aria-label="Tranh và từ gợi ý"] img');
    // The picture comes over the network: wait for it rather than sampling
    // the element at once (CP60.2 flake). A picture that never loads fails.
    await img
      .evaluate((el: HTMLImageElement) =>
        el.complete
          ? undefined
          : new Promise((done) => {
              el.addEventListener('load', done, { once: true });
              el.addEventListener('error', done, { once: true });
              setTimeout(done, 30_000);
            }),
      )
      .catch(() => undefined);
    check(
      'the picture loaded',
      await img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    );
    const editor = page.locator('#picture-answer');
    await editor.fill(`The cashier is scanning ${'very '.repeat(36)}slowly.`);
    const grade = page.getByRole('button', { name: 'Chấm bài' });
    check(
      '41 words: counter warns and "Chấm bài" is disabled',
      (await page.locator('#picture-word-count').innerText()).includes(
        '41/40',
      ) && (await grade.isDisabled()),
    );
    await editor.fill(
      'The cashier is scanning a jar while a woman pays by card. [[percent:80]]',
    );
    await grade.click();
    await page.getByRole('heading', { name: 'Kết quả' }).waitFor({
      timeout: 60_000,
    });
    const result = (
      await page.getByRole('region', { name: 'Bài viết của bạn' }).innerText()
    ).replace(/\s+/g, ' ');
    check(
      'the result appears beside the editor with criteria',
      /Kết quả \d+\/\d+/.test(result) && result.includes('Ngữ pháp'),
      result.slice(0, 140),
    );
    check(
      '"Tranh tiếp theo" leads to an ungraded picture',
      await page.getByRole('button', { name: 'Tranh tiếp theo' }).isVisible(),
    );
    await page.screenshot({
      path: `artifacts/qa-screens/cp58-picture-workspace-${width}.png`,
    });
    // CP58-H: an off-topic answer is capped, and the page shows the stored score.
    await page.getByRole('button', { name: 'Tranh tiếp theo' }).click();
    await page.waitForTimeout(1500);
    await page
      .locator('#picture-answer')
      .fill(
        'Two children are playing football at the beach because it is sunny [[scene:MISMATCH]] [[percent:90]].',
      );
    const submitted = page.waitForResponse(
      (r) =>
        /\/writing\/quizzes\/\d+\/submit/.test(r.url()) &&
        r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Chấm bài' }).click();
    const stored = (await (await submitted).json()).data;
    await page
      .getByRole('heading', { name: 'Kết quả' })
      .waitFor({ timeout: 60_000 });
    const capped = (
      await page.getByRole('region', { name: 'Bài viết của bạn' }).innerText()
    ).replace(/\s+/g, ' ');
    check(
      'off-topic answer: page shows the capped stored score and why',
      stored?.score <= 4 &&
        capped.includes(`Kết quả ${stored?.score}/${stored?.maxScore}`) &&
        capped.includes('không mô tả nội dung bức tranh'),
      capped.slice(0, 160),
    );
    await page.goto(`${FE}/writing/submissions/${stored?.submissionId}`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(2000);
    const review = (await page.locator('body').innerText()).replace(
      /\s+/g,
      ' ',
    );
    check(
      'result page shows the same stored score',
      new RegExp(`${stored?.score}\\s*/\\s*${stored?.maxScore}`).test(review),
      review.slice(0, 160),
    );

    // Direct link to a B1 picture as FREE
    await page.goto(`${FE}/writing/${B1}`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(1500);
    const locked = (await page.locator('body').innerText()).replace(
      /\s+/g,
      ' ',
    );
    check(
      'FREE opening a B1 picture directly: "Nội dung dành cho PRO"',
      locked.includes('Nội dung dành cho PRO'),
    );
    const crashes = issues.filter((i) => !i.startsWith('console:'));
    check(
      `${width}: no page errors or 5xx`,
      crashes.length === 0,
      crashes.join(' | '),
    );
    await browser.close();
  }

  // PLUS learner: still PRO for B1 pictures
  const admin = await newAdmin('cp58-pic-browser-admin');
  const { browser, page, account } = await studentPage('cp58-pic-plus', 1366);
  const planVersionId = Number(
    one(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and p.code = 'PLUS'`,
    ),
  );
  await call('POST', '/admin/subscriptions/grant', admin.token, {
    studentId: account.userId,
    planVersionId,
    durationDays: 30,
    reason: 'CP58 picture writing browser',
  });
  await hidePet(page);
  await page.goto(`${FE}/writing?tab=picture`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2000);
  const cards = page.locator('article');
  check(
    'PLUS: B1 pictures still say "Mở khóa với PRO", never PLUS',
    (await cards.filter({ hasText: 'Mở khóa với PRO' }).count()) === 5 &&
      (await cards.filter({ hasText: 'Mở khóa với PLUS' }).count()) === 0,
  );
  await browser.close();

  console.log(`\nCP58_PICTURE_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
