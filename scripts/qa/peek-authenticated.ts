/**
 * Authenticated peek at a handful of routes, to tell a redirect apart from a
 * broken render. Read-only; creates and deletes its own QA learner.
 *
 * Usage: npx ts-node scripts/qa/peek-authenticated.ts /classes /my-courses
 */
import {
  FE,
  createQaLearner,
  destroyQaLearner,
  launch,
  login,
  makeMarker,
  orphanCount,
  prisma,
} from './global-audit-lib';
import type { Browser } from 'playwright';

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('usage: peek-authenticated.ts <path> [path...]');
  process.exit(2);
}
const marker = makeMarker('peek');

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
    for (const path of paths) {
      const response = await page.goto(`${FE}${path}`, {
        waitUntil: 'networkidle',
        timeout: 35_000,
      });
      await page.waitForTimeout(1400);
      const text = (await page.locator('body').innerText()).trim();
      console.log(
        `\n--- ${path} -> ${new URL(page.url()).pathname} (http ${response?.status()}, ${text.length} chars)`,
      );
      console.log(
        text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 10)
          .map((line) => `    ${line}`)
          .join('\n'),
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
