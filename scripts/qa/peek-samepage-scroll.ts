/**
 * Same-page scroll stability, measured precisely enough to classify the cause.
 *
 * A filter that changes the URL is a router navigation, and the app's global
 * forward-navigation policy scrolls those to the top on purpose. A filter that
 * does not change the URL and still jumps to the top is a genuine defect. This
 * records the URL on both sides so the two cannot be confused.
 *
 * Read-only; creates and deletes its own QA learner.
 */
import {
  FE,
  createQaLearner,
  destroyQaLearner,
  launch,
  log,
  login,
  makeMarker,
  orphanCount,
  prisma,
} from './global-audit-lib';
import type { Browser, Page } from 'playwright';

const marker = makeMarker('samepage');

type Case = {
  label: string;
  path: string;
  control: RegExp;
};

const CASES: Case[] = [
  { label: 'reading category filter', path: '/reading', control: /Ngữ pháp/i },
  { label: 'reading difficulty filter', path: '/reading', control: /Cơ bản/i },
  {
    label: 'listening filter',
    path: '/listening',
    control: /Cơ bản|Hội thoại/i,
  },
  { label: 'speaking filter', path: '/speaking', control: /Cơ bản|Tất cả/i },
  { label: 'market category tab', path: '/market', control: /Vật phẩm/i },
  {
    label: 'flashcard list filter',
    path: '/flashcard',
    control: /Tất cả|Cơ bản/i,
  },
  { label: 'exams filter', path: '/exams', control: /TOEIC|Tất cả/i },
];

type CaseResult = Record<string, unknown>;

async function run(page: Page, testCase: Case): Promise<CaseResult> {
  const out: Record<string, unknown> = {
    label: testCase.label,
    path: testCase.path,
  };
  try {
    await page.goto(`${FE}${testCase.path}`, {
      waitUntil: 'networkidle',
      timeout: 35_000,
    });
    await page
      .locator('h1, h2, main')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForTimeout(800);
    await page.evaluate(() =>
      window.scrollTo(0, Math.min(700, document.documentElement.scrollHeight)),
    );
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.scrollY);
    const urlBefore = page.url();
    if (before === 0) {
      return { ...out, verdict: 'BLOCKED', note: 'page not scrollable' };
    }
    const control = page
      .getByRole('button', { name: testCase.control })
      .or(page.getByRole('tab', { name: testCase.control }))
      .or(page.getByRole('link', { name: testCase.control }));
    if (!(await control.count())) {
      return { ...out, verdict: 'BLOCKED', note: 'control not found', before };
    }
    await control.first().click();
    await page.waitForTimeout(1300);
    const after = await page.evaluate(() => window.scrollY);
    const urlAfter = page.url();
    const urlChanged = urlBefore !== urlAfter;
    return {
      ...out,
      before,
      after,
      urlBefore: new URL(urlBefore).pathname + new URL(urlBefore).search,
      urlAfter: new URL(urlAfter).pathname + new URL(urlAfter).search,
      urlChanged,
      // Only an in-place interaction that jumps to the top is a defect; a URL
      // change is a navigation and the global scroll-to-top policy owns it.
      verdict: after > 2 ? 'PASS' : urlChanged ? 'NAVIGATION' : 'FAIL',
    };
  } catch (error) {
    return {
      ...out,
      verdict: 'BLOCKED',
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  let browser: Browser | undefined;
  let learnerId: number | undefined;
  try {
    const learner = await createQaLearner(marker, 'PLUS');
    learnerId = learner.userId;
    browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 860 },
    });
    await login(page, learner);
    const results: CaseResult[] = [];
    for (const testCase of CASES) {
      const result = await run(page, testCase);
      results.push(result);
      await log('samepage', marker, { test: 'same-page-scroll', ...result });
      console.log(
        `${String(result.verdict).padEnd(11)} ${testCase.label.padEnd(28)} before=${String(result.before ?? '-').padEnd(5)} after=${String(result.after ?? '-').padEnd(5)} urlChanged=${String(result.urlChanged ?? '-')} ${String(result.urlAfter ?? '')} ${String(result.note ?? '')}`,
      );
    }
    const fails = results.filter((r) => r.verdict === 'FAIL');
    const navs = results.filter((r) => r.verdict === 'NAVIGATION');
    console.log(
      `\nin-place resets (defects)=${fails.length}  url-changing filters (policy)=${navs.length}  stable=${results.filter((r) => r.verdict === 'PASS').length}  blocked=${results.filter((r) => r.verdict === 'BLOCKED').length}`,
    );
  } finally {
    await browser?.close();
    if (learnerId) await destroyQaLearner(learnerId);
    console.log(`QA_ORPHAN_RECORDS_AFTER_CLEANUP=${await orphanCount(marker)}`);
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
