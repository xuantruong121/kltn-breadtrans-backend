/**
 * CP60-DIAG (harness only, mock graders): the V3 result page and profile tab
 * in desktop Chromium at 1366 and 1440. Each case submits through the API as
 * the logged-in learner, then reads what the page shows.
 *
 *   QA_WAV=<answer.wav> SHOTS=<dir> npx ts-node --transpile-only scripts/qa/cp60diag-result-browser.ts
 */
import { mkdirSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { runCase, type Plan } from './cp60diag-observed-api';

const SHOTS = process.env.SHOTS ?? 'qa-shots-cp60diag';
mkdirSync(SHOTS, { recursive: true });
/**
 * What may name a level on this page, and nothing else: the disclaimer, the
 * note that catalog titles carry content labels, and those catalog title
 * suffixes such as "(B1)" (the same titles the practice catalog shows).
 */
const scrubbed = (text: string) =>
  text
    .replace(/không quy đổi sang trình độ CEFR/g, '')
    .replace(/Nhãn như \(A2\), \(B1\)[^.]*\./g, '')
    .replace(/ \((?:A1|A2|B1|B2|C1|C2)\)(?= )/g, '');
const CEFR = /\b(?:A1|A2|B1|B2|C1|C2|CEFR level|trình độ (?:A|B|C)\d)\b/;

async function run(label: string, width: number, plan: Plan, expect: string[]) {
  if (process.env.ONLY && process.env.ONLY !== label) return;
  const { browser, page, account, issues } = await studentPage(
    `cp60diag-ui-${label.toLowerCase()}`,
    width,
  );
  page.on('response', (r) => {
    if (r.status() === 403 && process.env.DUMP)
      console.log('403', r.url().slice(0, 140));
  });
  try {
    await runCase(label, plan, account);
    await page.goto(`${FE}/diagnostic`, { waitUntil: 'networkidle' });
    await hidePet(page);
    await page.getByText('Điểm quan sát').first().waitFor({ timeout: 60_000 });
    await page.getByText('Điểm được tính như thế nào?').click();
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({
      path: `${SHOTS}/${label}-${width}-result.png`,
      fullPage: true,
    });
    await page.addStyleTag({ content: 'header{position:static!important}' });
    await page
      .locator('section')
      .first()
      .screenshot({ path: `${SHOTS}/${label}-${width}-overview.png` });
    if (process.env.DUMP) console.log(text.slice(text.indexOf('Bài Nói'), text.indexOf('Bài Nói') + 900));
    check(
      `${label}@${width} result page shows ${expect.join(' | ')}`,
      expect.every((t) => text.includes(t)),
      expect.filter((t) => !text.includes(t)).join(' | '),
    );
    check(
      `${label}@${width} no CEFR level or certificate claim`,
      !CEFR.test(scrubbed(text)),
      (() => {
        const t = scrubbed(text);
        const m = CEFR.exec(t);
        return m ? t.slice(Math.max(0, m.index - 120), m.index + 60) : '';
      })(),
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    check(`${label}@${width} no horizontal overflow`, !overflow);

    await page.goto(`${FE}/hub?tab=diagnostic-result`, {
      waitUntil: 'networkidle',
    });
    await hidePet(page);
    await page.getByText('Điểm quan sát').first().waitFor({ timeout: 60_000 });
    const tab = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({
      path: `${SHOTS}/${label}-${width}-profile.png`,
      fullPage: true,
    });
    check(
      `${label}@${width} profile tab shows the same observed score`,
      tab.includes(expect[0]),
    );
    // The harness origin is not registered with Google Identity Services, so
    // its button logs an origin error and 403s on every page. Nothing else
    // is ignored.
    const real = issues.filter(
      (i) => !/GSI_LOGGER|status of 403 \(\)$/.test(i),
    );
    check(`${label}@${width} no page errors`, real.length === 0, real.join('; '));
  } finally {
    await browser.close();
  }
}

async function main() {
  // T01: everything productive skipped -> objective-only observed score.
  for (const width of [1366, 1440])
    await run(
      'T01',
      width,
      { listening: 6, reading: 8, speaking: ['skip', 'skip'], writing: ['skip', 'skip'] },
      ['70', 'Chưa đánh giá', 'không phải điểm 0', 'bỏ qua – không tính điểm', '= 70%'],
    );
  // T08: one task each -> limited evidence on both.
  await run(
    'T08',
    1366,
    { listening: 5, reading: 5, speaking: ['record', 'skip'], writing: ['full', 'skip'] },
    ['54,4', 'Đánh giá 1/2 bài', 'bằng chứng còn hạn chế', '= 85%', 'Độ khó 1/4', 'Hoàn thành yêu cầu (30%)'],
  );
  // T10: full evidence.
  await run(
    'T10',
    1440,
    { listening: 10, reading: 10, speaking: ['record', 'record'], writing: ['full', 'full'] },
    ['92,5', 'Đủ 2/2 bài', '= 100%'],
  );
  console.log(`\nCP60DIAG_RESULT_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
