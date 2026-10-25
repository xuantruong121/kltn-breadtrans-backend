/**
 * Arena browser smoke: balance presentation, stake selection, and the
 * insufficient-balance UX on a QA learner that legitimately has 0 Banh Mi.
 *
 * No currency is granted to anyone, and no match is completed. Read-only
 * against canonical data; the QA learner is deleted in the finally block.
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

const marker = makeMarker('arena');

async function main() {
  let browser: Browser | undefined;
  let learnerId: number | undefined;
  const out: Record<string, unknown> = {};
  try {
    const learner = await createQaLearner(marker, 'PLUS');
    learnerId = learner.userId;
    browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 860 },
    });
    await login(page, learner);
    await page.goto(`${FE}/arena`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const body = await page.locator('body').innerText();
    const stakeButtons = await page
      .getByRole('button', { name: /\d+\s*Bánh/ })
      .count();
    out.stakeButtons = stakeButtons;
    out.leaderboardPresent = /[Xx]ếp hạng|Top/.test(body);
    out.balanceShown = /Bánh/.test(body);

    // Stake selection must not throw the learner back to the top of the page.
    await page.evaluate(() =>
      window.scrollTo(0, Math.min(500, document.documentElement.scrollHeight)),
    );
    await page.waitForTimeout(250);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    if (stakeButtons > 1) {
      await page
        .getByRole('button', { name: /\d+\s*Bánh/ })
        .nth(1)
        .click();
      await page.waitForTimeout(900);
    }
    out.stakeSelectScrollBefore = scrollBefore;
    out.stakeSelectScrollAfter = await page.evaluate(() => window.scrollY);

    // The real label on the CTA.
    const cta = page.getByRole('button', { name: /Tìm đối thủ ngay/ });
    out.ctaFound = (await cta.count()) > 0;
    if (out.ctaFound) {
      // This learner has 0 Banh Mi, so the server must refuse the stake. What
      // matters here is what the learner is shown when it does.
      await cta.first().click();
      await page.waitForTimeout(3500);
      const after = await page.locator('body').innerText();
      out.showsHumanReadableRefusal = /không đủ/i.test(after);
      out.refusalMessage =
        after
          .split('\n')
          .map((line) => line.trim())
          .find((line) => /không đủ/i.test(line)) ?? null;
      out.rawJsonLeak = /\{"|"statusCode"|undefined|\[object/.test(after);
      out.stackTraceLeak = /TypeError:|at Object\.|at async /.test(after);
      out.stuckInSearching = /Đang tìm đối thủ/.test(after);
      out.ctaStillPresent =
        (await page.getByRole('button', { name: /Tìm đối thủ ngay/ }).count()) >
        0;
    }

    await log('arena', marker, { test: 'arena-states', ...out });
    console.log(JSON.stringify(out, null, 2));
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
