/**
 * Speaking result layout on the disposable harness (mock grader): after a
 * graded recording there is one re-record and one next-exercise control (in
 * the footer), and the header and footer stay on screen while the content
 * scrolls, at desktop and phone width.
 *
 * Usage: npx ts-node scripts/qa/finalization-speaking-frame-browser.ts <16 kHz WAV>
 */
import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots`;

async function run(width: number, wav: string) {
  const { browser, page } = await studentPage(`frame-${width}`, width, false, [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
  ]);
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.goto(`${FE}/speaking/1`);
  await hidePet(page);
  await page
    .getByRole('button', { name: 'Bắt đầu thu âm', exact: true })
    .first()
    .click();
  await page.waitForTimeout(4000);
  await page
    .getByRole('button', { name: /Dừng ghi âm và chấm điểm|Dừng & chấm điểm/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /Câu tiếp theo/ })
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);

  const visible = (name: RegExp) =>
    page.getByRole('button', { name }).filter({ visible: true }).count();
  check(
    `${width}px: one "Ghi âm lại" control`,
    (await visible(/Ghi âm lại/)) === 1,
    String(await visible(/Ghi âm lại/)),
  );
  check(
    `${width}px: one next control, none inside the card`,
    (await visible(/Bài tiếp theo|Câu tiếp theo/)) === 1,
    String(await visible(/Bài tiếp theo|Câu tiếp theo/)),
  );

  // Scroll every scrollable region to the end, then measure the bars.
  await page.evaluate(() => {
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('main, main section'),
    ))
      el.scrollTop = el.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(300);
  const bars = await page.evaluate(() => {
    const header = document.querySelector('header')!.getBoundingClientRect();
    const footer = document.querySelector('footer')!.getBoundingClientRect();
    return {
      headerTop: header.top,
      footerBottom: footer.bottom,
      vh: window.innerHeight,
      pageScroll: document.scrollingElement!.scrollHeight > window.innerHeight,
    };
  });
  check(
    `${width}px: header and footer stay on screen after scrolling`,
    bars.headerTop >= 0 && bars.footerBottom <= bars.vh + 1,
    JSON.stringify(bars),
  );
  await page.screenshot({ path: `${SHOTS}/speaking-frame-${width}.png` });
  await browser.close();
}

void (async () => {
  for (const width of [1366, 390]) await run(width, process.argv[2]);
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
})();
