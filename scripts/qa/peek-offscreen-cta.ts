/**
 * Identifies the controls my responsive detector flagged as offscreen, so a
 * horizontally-scrollable strip or a closed off-canvas drawer is not reported
 * as an unreachable CTA. Read-only; QA learner removed in finally.
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
import type { Browser } from 'playwright';

const marker = makeMarker('offscreen');

const TARGETS = [
  { path: '/exams', width: 390 },
  { path: '/exams', width: 834 },
  { path: '/market', width: 390 },
  { path: '/arena', width: 390 },
  { path: '/listening/1', width: 390 },
];

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

    for (const target of TARGETS) {
      await page.setViewportSize({ width: target.width, height: 844 });
      await page.goto(`${FE}${target.path}`, {
        waitUntil: 'networkidle',
        timeout: 35_000,
      });
      await page.waitForTimeout(1000);
      const found = await page.evaluate(() => {
        const rows: Array<Record<string, unknown>> = [];
        for (const node of Array.from(
          document.querySelectorAll('button, a[href]'),
        )) {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.left < window.innerWidth + 1 && rect.right > -1) continue;
          // Walk up looking for a scroll container or a transformed drawer:
          // either means the control is reachable, just not on screen now.
          let scrollableAncestor = false;
          let transformedAncestor = false;
          let ariaHidden = false;
          let element: HTMLElement | null = node as HTMLElement;
          while (element && element !== document.body) {
            const style = getComputedStyle(element);
            if (
              style.overflowX === 'auto' ||
              style.overflowX === 'scroll' ||
              element.scrollWidth > element.clientWidth + 4
            ) {
              scrollableAncestor = true;
            }
            if (style.transform && style.transform !== 'none') {
              transformedAncestor = true;
            }
            if (element.getAttribute('aria-hidden') === 'true') {
              ariaHidden = true;
            }
            element = element.parentElement;
          }
          rows.push({
            label: (node.textContent ?? '').trim().slice(0, 44),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            scrollableAncestor,
            transformedAncestor,
            ariaHidden,
            classification: scrollableAncestor
              ? 'REACHABLE_IN_SCROLL_STRIP'
              : transformedAncestor || ariaHidden
                ? 'OFFCANVAS_OR_HIDDEN_PANEL'
                : 'GENUINELY_UNREACHABLE',
          });
        }
        return rows;
      });
      await log('offscreen', marker, {
        test: 'offscreen-cta',
        path: target.path,
        width: target.width,
        found,
      });
      console.log(
        `\n${target.path} @${target.width}px -> ${found.length} flagged`,
      );
      for (const row of found) {
        console.log(
          `  ${String(row.classification).padEnd(26)} left=${String(row.left)} right=${String(row.right)} "${String(row.label)}"`,
        );
      }
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
