/**
 * Distinguishes a real scroll-reset defect from ordinary browser clamping.
 *
 * When a filter shortens a list, the document can become shorter than the
 * current scroll offset and the browser clamps scrollY down - that is correct
 * behaviour, not a reset. The two look identical if only scrollY is measured,
 * so this records the maximum scrollable offset on both sides of the click.
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

const marker = makeMarker('clamp');

type Case = { label: string; path: string; control: RegExp };

const CASES: Case[] = [
  { label: 'reading difficulty filter', path: '/reading', control: /Cơ bản/i },
  {
    label: 'listening filter',
    path: '/listening',
    control: /Cơ bản|Hội thoại/i,
  },
  { label: 'speaking filter', path: '/speaking', control: /Cơ bản|Tất cả/i },
  { label: 'market category tab', path: '/market', control: /Vật phẩm/i },
  { label: 'exams filter', path: '/exams', control: /TOEIC|Tất cả/i },
];

const metrics = () => ({
  scrollY: Math.round(window.scrollY),
  maxScroll: Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  ),
  scrollHeight: document.documentElement.scrollHeight,
  innerHeight: window.innerHeight,
});

async function run(
  page: Page,
  testCase: Case,
): Promise<Record<string, unknown>> {
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
    await page.waitForTimeout(900);
    await page.evaluate(() =>
      window.scrollTo(0, Math.min(700, document.documentElement.scrollHeight)),
    );
    await page.waitForTimeout(300);
    const before = await page.evaluate(metrics);

    const control = page
      .getByRole('button', { name: testCase.control })
      .or(page.getByRole('tab', { name: testCase.control }));
    if (!(await control.count())) {
      return { ...out, verdict: 'BLOCKED', note: 'control not found' };
    }
    await control.first().click();
    await page.waitForTimeout(1400);
    const after = await page.evaluate(metrics);

    // If the shortened page cannot hold the old offset, the browser clamped it
    // and the final position is simply the new bottom - not a reset to top.
    const clampExplains = after.scrollY >= after.maxScroll - 2;
    const verdict =
      after.scrollY > 2
        ? 'STABLE'
        : clampExplains
          ? 'CLAMPED_BY_SHORTER_PAGE'
          : 'RESET_DEFECT';
    return { ...out, before, after, clampExplains, verdict };
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
    const results: Record<string, unknown>[] = [];
    for (const testCase of CASES) {
      const result = await run(page, testCase);
      results.push(result);
      await log('clamp', marker, { test: 'filter-scroll-clamp', ...result });
      const before = result.before as ReturnType<typeof metrics> | undefined;
      const after = result.after as ReturnType<typeof metrics> | undefined;
      console.log(
        `${String(result.verdict).padEnd(24)} ${testCase.label.padEnd(26)} ` +
          `scrollY ${String(before?.scrollY ?? '-')}->${String(after?.scrollY ?? '-')}  ` +
          `maxScroll ${String(before?.maxScroll ?? '-')}->${String(after?.maxScroll ?? '-')}  ` +
          `docH ${String(before?.scrollHeight ?? '-')}->${String(after?.scrollHeight ?? '-')} ${String(result.note ?? '')}`,
      );
    }
    const defects = results.filter((r) => r.verdict === 'RESET_DEFECT').length;
    const clamped = results.filter(
      (r) => r.verdict === 'CLAMPED_BY_SHORTER_PAGE',
    ).length;
    console.log(
      `\nRESET_DEFECT=${defects}  CLAMPED_BY_SHORTER_PAGE=${clamped}  STABLE=${results.filter((r) => r.verdict === 'STABLE').length}  BLOCKED=${results.filter((r) => r.verdict === 'BLOCKED').length}`,
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
