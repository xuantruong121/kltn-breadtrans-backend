/**
 * A Free learner opening a locked Speaking or Writing item sees the plan lock
 * (levels opened, so only the plan stands in the way) and, under it, a fixed sample graded result labelled "Bài mẫu". A locked
 * quiz (no sample) keeps the short lock card.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/locked-sample-browser.ts
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';

import { check, failureCount, unlockAllLevels } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/locked-sample`;
const one = (sql: string) => harnessQuery(sql)[0]?.[0];

async function lockText(page: Page, path: string) {
  await page.goto(`${FE}${path}`);
  await hidePet(page);
  await page
    .getByRole('heading', { name: /Nội dung dành cho gói/ })
    .waitFor({ timeout: 60_000 });
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const speakingId = Number(
    one(
      `select id from "SpeakingExercise" where "practiceSetId" = 'practice-pronunciation-b1' order by "order" limit 1`,
    ),
  );
  check('a B1 speaking exercise exists', speakingId > 0, String(speakingId));

  for (const width of [1366, 390]) {
    const { browser, page, issues, account } = await studentPage(
      `locked-sample-${width}`,
      width,
    );
    // Open every level, so the plan lock is what stands in the way.
    unlockAllLevels(account.userId);

    const speaking = await lockText(page, `/speaking/${speakingId}`);
    check(`${width}px speaking: lock card shown`, speaking.includes('Xem gói'));
    check(
      `${width}px speaking: sample labelled`,
      speaking.includes('Bài mẫu') &&
        speaking.includes('không phải bài của bạn'),
    );
    check(
      `${width}px speaking: sample score and criteria`,
      speaking.includes('Điểm luyện Speaking: 7.5/10') &&
        speaking.includes('Độ trôi chảy'),
    );
    check(
      `${width}px speaking: not an official score`,
      speaking.includes('không phải điểm thi chính thức'),
    );
    await page.screenshot({
      path: `${SHOTS}/speaking-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('link', { name: /Xem gói/ }).scrollIntoViewIfNeeded();
    check(
      `${width}px speaking: plan link reachable`,
      await page.getByRole('link', { name: /Xem gói/ }).isVisible(),
    );

    const writing = await lockText(page, '/writing/18');
    check(`${width}px writing: sample labelled`, writing.includes('Bài mẫu'));
    check(
      `${width}px writing: rubric and correction`,
      writing.includes('Hoàn thành yêu cầu') &&
        writing.includes('Would 9 a.m. on Monday work for you?'),
    );
    check(
      `${width}px writing: score`,
      writing.includes('Điểm luyện Writing: 8/10'),
    );
    await page.screenshot({
      path: `${SHOTS}/writing-${width}.png`,
      fullPage: true,
    });

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    check(
      `${width}px: no sideways page scroll`,
      overflow <= 0,
      String(overflow),
    );
    // The 403 on the locked item's own API call is how the page learns it is
    // locked; anything else is a fault.
    const faults = issues.filter((i) => !i.includes('status of 403'));
    check(
      `${width}px: no page errors besides the expected 403`,
      faults.length === 0,
      faults.join(' | '),
    );
    await browser.close();
  }

  console.log(`\nLOCKED_SAMPLE_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
