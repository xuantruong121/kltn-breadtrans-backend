/**
 * Back-navigation detail: records the main-frame URL sequence and history
 * length so "Back did not leave the detail page" can be told apart from
 * "Back returned but did not restore scroll".
 *
 * Read-only; QA learner removed in finally.
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

const marker = makeMarker('back');

const CASES = [
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
  {
    list: '/flashcard',
    click: /Bắt đầu học|Ôn tập|Học ngay/i,
    detail: /\/flashcard\/\d+/,
  },
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

    for (const testCase of CASES) {
      const visited: string[] = [];
      const onNav = (frame: import('playwright').Frame) => {
        if (frame === page.mainFrame()) {
          visited.push(new URL(frame.url()).pathname);
        }
      };
      await page.goto(`${FE}${testCase.list}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.evaluate(() =>
        window.scrollTo(
          0,
          Math.min(800, document.documentElement.scrollHeight),
        ),
      );
      await page.waitForTimeout(350);
      const leftAt = await page.evaluate(() => window.scrollY);
      const historyBefore = await page.evaluate(() => history.length);

      page.on('framenavigated', onNav);
      const target = page
        .getByRole('link', { name: testCase.click })
        .or(page.getByRole('button', { name: testCase.click }));
      if (!(await target.count()) || leftAt === 0) {
        page.off('framenavigated', onNav);
        console.log(
          `BLOCKED  ${testCase.list} (${leftAt === 0 ? 'not scrollable' : 'no control'})`,
        );
        continue;
      }
      await target.first().click();
      await page
        .waitForURL(testCase.detail, { timeout: 25_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200);
      const detailPath = new URL(page.url()).pathname;
      const historyAfterForward = await page.evaluate(() => history.length);

      await page.goBack({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1400);
      const afterFirstBack = new URL(page.url()).pathname;
      const scrollAfterFirstBack = await page.evaluate(() => window.scrollY);

      // If one Back did not leave the detail, the forward click pushed more
      // than one history entry; a second Back shows that.
      let afterSecondBack: string | null = null;
      let scrollAfterSecondBack: number | null = null;
      if (afterFirstBack !== testCase.list) {
        await page.goBack({ waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        afterSecondBack = new URL(page.url()).pathname;
        scrollAfterSecondBack = await page.evaluate(() => window.scrollY);
      }
      page.off('framenavigated', onNav);

      const row = {
        list: testCase.list,
        leftAt,
        detailPath,
        historyBefore,
        historyAfterForward,
        historyEntriesAdded: historyAfterForward - historyBefore,
        navigationSequence: visited,
        afterFirstBack,
        scrollAfterFirstBack,
        afterSecondBack,
        scrollAfterSecondBack,
        returnedToListInOneBack: afterFirstBack === testCase.list,
        scrollRestored:
          afterFirstBack === testCase.list
            ? scrollAfterFirstBack >= leftAt * 0.5
            : (scrollAfterSecondBack ?? 0) >= leftAt * 0.5,
      };
      await log('back', marker, { test: 'back-restoration-detail', ...row });
      console.log(
        `\n${testCase.list}: left@${leftAt} -> ${detailPath} (history +${row.historyEntriesAdded})`,
      );
      console.log(`  nav sequence: ${visited.join(' -> ') || '(none)'}`);
      console.log(
        `  back#1 -> ${afterFirstBack} scroll=${scrollAfterFirstBack}` +
          (afterSecondBack
            ? `   back#2 -> ${afterSecondBack} scroll=${scrollAfterSecondBack}`
            : ''),
      );
      console.log(
        `  returnedInOneBack=${row.returnedToListInOneBack} scrollRestored=${row.scrollRestored}`,
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
