/**
 * Checkpoint 58 catalogs (harness, Chromium 1366 and 1440): the four skill
 * catalogs share one difficulty / status / sort toolbar, default to Dễ → Khó
 * over the whole list, label each card from the API's CEFR level (Writing B1
 * is Trung cấp) and show Vietnamese titles.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-catalogs-browser.ts
 */
import type { Page } from 'playwright';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';

const BAND_RANK: Record<string, number> = {
  'Cơ bản': 0,
  'Trung cấp': 1,
  'Nâng cao': 2,
};
const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LABEL = /(Cơ bản|Trung cấp|Nâng cao) · ([ABC][12])(?:–([ABC][12]))?/;

async function open(page: Page, path: string) {
  await page.goto(`${FE}${path}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
}

/** Level of each catalog card in display order ([band, min, max]). */
async function cardLevels(page: Page) {
  const texts = await page.locator('article').allInnerTexts();
  return texts.map((t) => {
    const m = LABEL.exec(t.replace(/\s+/g, ' '));
    return m
      ? {
          band: m[1],
          min: CEFR.indexOf(m[2]),
          max: CEFR.indexOf(m[3] ?? m[2]),
          text: t.replace(/\s+/g, ' ').slice(0, 70),
        }
      : null;
  });
}

const shownCount = async (page: Page) =>
  Number(
    (await page.getByTestId('catalog-result-count').innerText()).match(
      /\d+/,
    )?.[0],
  );

async function checkSkill(page: Page, label: string, path: string) {
  await open(page, path);
  const sort = page.getByLabel('Sắp xếp theo độ khó');
  check(
    `${label}: shared toolbar, default Dễ → Khó`,
    (await sort.inputValue()) === 'EASY_TO_HARD' &&
      (
        await page
          .getByRole('group', { name: 'Lọc theo độ khó' })
          .getByRole('button')
          .allInnerTexts()
      ).join('|') === 'Tất cả|Cơ bản|Trung cấp|Nâng cao',
  );
  const levels = await cardLevels(page);
  const known = levels.filter((l) => l !== null);
  const ordered = known.every((l, i) => i === 0 || known[i - 1].min <= l.min);
  check(
    `${label}: every card has a level label, A1 → C2 order over ${levels.length} cards`,
    levels.length > 0 && known.length === levels.length && ordered,
    levels.map((l) => (l ? `${CEFR[l.min]}-${CEFR[l.max]}` : '?')).join(' '),
  );
  check(
    `${label}: result count = cards shown`,
    (await shownCount(page)) === levels.length,
  );
  await sort.selectOption('HARD_TO_EASY');
  await page.waitForTimeout(400);
  const hard = (await cardLevels(page)).filter((l) => l !== null);
  check(
    `${label}: Khó → Dễ reverses the order`,
    hard.every((l, i) => i === 0 || hard[i - 1].min >= l.min),
  );
  await sort.selectOption('EASY_TO_HARD');
  await page
    .getByRole('group', { name: 'Lọc theo độ khó' })
    .getByRole('button', { name: 'Trung cấp' })
    .click();
  await page.waitForTimeout(400);
  const mid = await cardLevels(page);
  check(
    `${label}: Trung cấp shows only Trung cấp cards (${mid.length})`,
    mid.length > 0 && mid.every((l) => l?.band === 'Trung cấp'),
    mid
      .filter((l) => l?.band !== 'Trung cấp')
      .map((l) => l?.text)
      .join(' | '),
  );
  check(
    `${label}: count follows the filter`,
    (await shownCount(page)) === mid.length,
  );
  await page
    .getByRole('button', { name: 'Đặt lại tất cả bộ lọc về mặc định' })
    .click();
  await page.waitForTimeout(300);
  check(
    `${label}: reset restores the full list`,
    (await shownCount(page)) === levels.length,
  );
  return levels;
}

void (async () => {
  for (const width of [1366, 1440]) {
    console.log(`\n== ${width}px`);
    const { browser, page, issues } = await studentPage(
      `cp58-catalog-${width}`,
      width,
    );
    await hidePet(page);

    const listening = await checkSkill(page, 'Listening', '/listening');
    void listening;
    await checkSkill(page, 'Reading', '/reading');
    await checkSkill(page, 'Speaking', '/speaking');
    await checkSkill(page, 'Writing', '/writing');

    // The confirmed defect: Writing B1 email is Trung cấp, with a Vietnamese title.
    const card = page.locator('article', {
      hasText: 'Viết email công việc (B1)',
    });
    const cardText = (await card.innerText()).replace(/\s+/g, ' ');
    check(
      'Writing B1 email: "Viết email công việc (B1)" labelled Trung cấp · B1',
      cardText.includes('Trung cấp · B1') && !cardText.includes('Cơ bản'),
      cardText.slice(0, 120),
    );
    const english = await page
      .locator('article h3')
      .filter({ hasText: /^(Writing|Listening|Reading) [ABC][12]/ })
      .count();
    check('Writing: no English catalog title left', english === 0);

    // Grammar layout runs on the owner app: cp58-grammar-owner-browser.ts
    // (the harness snapshot predates the 13/14 replacement topics).
    await open(page, '/writing');
    await page.screenshot({
      path: `artifacts/qa-screens/cp58-writing-${width}.png`,
    });
    const crashes = issues.filter((i) => !i.startsWith('console:'));
    check(
      `${width}: no page errors or 5xx`,
      crashes.length === 0,
      crashes.join(' | '),
    );
    await browser.close();
  }
  console.log(`\nCP58_CATALOG_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
