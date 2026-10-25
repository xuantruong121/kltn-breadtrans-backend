/**
 * Responsive smoke (desktop / tablet / mobile) plus Back-restoration, over the
 * representative learner screens. Read-only; QA learner removed in finally.
 *
 * Usage: npx ts-node scripts/qa/global-responsive-phase.ts
 */
import {
  FE,
  VIEWPORTS,
  auditResponsive,
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

const marker = makeMarker('responsive');

async function screens() {
  const [course, vocabTopic, listening, speaking, reading, writing] =
    await Promise.all([
      prisma.course.findFirst({
        where: { status: 'PUBLISHED' },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      prisma.vocabTopic.findFirst({
        where: { publicationStatus: 'PUBLISHED' },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      prisma.quiz.findFirst({
        where: {
          type: 'LISTENING_PRACTICE',
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      prisma.speakingExercise.findFirst({
        where: { publicationStatus: 'PUBLISHED', isPremiumContent: false },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      prisma.quiz.findFirst({
        where: {
          type: 'BILINGUAL_READING',
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      prisma.quiz.findFirst({
        where: {
          type: 'WRITING_PICTURE',
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    ]);
  const lr = await prisma.exam.findFirst({
    where: { publicationStatus: 'PUBLISHED', variantCode: 'TOEIC_LR' },
    select: { id: true },
  });
  const paths = [
    '/dashboard',
    '/courses',
    course ? `/courses/${course.id}` : null,
    '/flashcard',
    vocabTopic ? `/flashcard/${vocabTopic.id}` : null,
    '/listening',
    listening ? `/listening/${listening.id}` : null,
    '/speaking',
    speaking ? `/speaking/${speaking.id}` : null,
    '/reading',
    reading ? `/reading/${reading.id}` : null,
    '/writing',
    writing ? `/writing/${writing.id}` : null,
    '/market',
    '/arena',
    '/exams',
    lr ? `/exams/${lr.id}` : null,
    '/profile',
  ].filter((value): value is string => Boolean(value));
  return paths;
}

/** Back from a detail page should return to the list it came from (§12). */
async function auditBackRestoration(
  page: Page,
  listPath: string,
  clickName: RegExp,
  detailUrl: RegExp,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { listPath };
  try {
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.goto(`${FE}${listPath}`, {
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
      window.scrollTo(0, Math.min(800, document.documentElement.scrollHeight)),
    );
    await page.waitForTimeout(350);
    const scrollBeforeLeaving = await page.evaluate(() => window.scrollY);
    const target = page
      .getByRole('link', { name: clickName })
      .or(page.getByRole('button', { name: clickName }));
    if (!(await target.count()) || scrollBeforeLeaving === 0) {
      return {
        ...out,
        verdict: 'BLOCKED',
        note: scrollBeforeLeaving === 0 ? 'not scrollable' : 'no control',
      };
    }
    await target.first().click();
    await page.waitForURL(detailUrl, { timeout: 25_000 });
    await page.waitForTimeout(900);
    const detail = new URL(page.url()).pathname;
    await page.goBack({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const returnedPath = new URL(page.url()).pathname;
    const restoredScroll = await page.evaluate(() => window.scrollY);
    return {
      ...out,
      scrollBeforeLeaving,
      detail,
      returnedPath,
      restoredScroll,
      returnedToList: returnedPath === listPath,
      // Restoration is judged on being near where the learner was, not exact.
      scrollRestored: restoredScroll >= scrollBeforeLeaving * 0.5,
      verdict:
        returnedPath === listPath && restoredScroll >= scrollBeforeLeaving * 0.5
          ? 'PASS'
          : 'FAIL',
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
    const paths = await screens();
    const learner = await createQaLearner(marker, 'PLUS');
    learnerId = learner.userId;
    browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 860 },
    });
    await login(page, learner);

    console.log(
      `responsive: ${paths.length} screens x ${VIEWPORTS.length} viewports`,
    );
    let fails = 0;
    for (const path of paths) {
      const row: string[] = [];
      for (const viewport of VIEWPORTS) {
        const result = await auditResponsive(page, path, viewport);
        await log('responsive', marker, { test: 'responsive', ...result });
        if (result.verdict === 'FAIL') fails += 1;
        row.push(
          `${viewport.name}=${result.verdict === 'PASS' ? 'ok' : `OVERFLOW:${String(result.overflowPx)}px/offscreen:${String(result.offscreenCta)}`}`,
        );
      }
      console.log(`  ${path.padEnd(22)} ${row.join('  ')}`);
    }
    console.log(`\nresponsive failures: ${fails}`);

    console.log('\nback restoration');
    const backCases = [
      {
        list: '/courses',
        click: /Xem chi tiết|Vào học|Chi tiết|Bắt đầu/i,
        detail: /\/courses\/\d+/,
      },
      {
        list: '/listening',
        click: /Bắt đầu|Luyện nghe|Vào bài/i,
        detail: /\/listening\/\d+/,
      },
      {
        list: '/exams',
        click: /TOEIC 2 Skills: Listening/i,
        detail: /\/exams\/\d+/,
      },
    ];
    for (const testCase of backCases) {
      const result = await auditBackRestoration(
        page,
        testCase.list,
        testCase.click,
        testCase.detail,
      );
      await log('responsive', marker, { test: 'back-restoration', ...result });
      console.log(
        `  ${String(result.verdict).padEnd(8)} ${testCase.list.padEnd(12)} left@${String(result.scrollBeforeLeaving ?? '-')} returned=${String(result.returnedPath ?? '-')} restoredScroll=${String(result.restoredScroll ?? '-')} ${String(result.note ?? '')}`,
      );
    }
  } finally {
    await browser?.close();
    if (learnerId) await destroyQaLearner(learnerId);
    console.log(
      `\nQA_ORPHAN_RECORDS_AFTER_CLEANUP=${await orphanCount(marker)}`,
    );
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
