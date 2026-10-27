/**
 * TOEIC L&R exam page in real Chromium, disposable harness (FE :3100).
 *
 * Full Test: two-mode start screen, fullscreen kept, Part tabs (one Part
 * rendered at a time), compact sidebar (no Part buttons), jump to Q150,
 * Part 1-2 text hidden, the continuous master (duration, Range, play, seek,
 * survives Part switches), review flags by clicking the question number,
 * manual save + restore, reload, minutes-only timer, submit and result.
 * Part practice (Part 2 + Part 6): only those Parts, the Part 2 audio
 * segment, part-scoped result without a converted score. Reading-only
 * practice: no audio player. Mobile 390 px: drawer navigator, no overflow.
 */
import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';

import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';
const EXAM_PAGE = `${FE}/exams/2`;

const fullscreen = (page: Page) =>
  page.evaluate(() => Boolean(document.fullscreenElement));
const audioState = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector('audio') as HTMLAudioElement;
    return {
      src: a.currentSrc,
      t: a.currentTime,
      d: a.duration,
      paused: a.paused,
    };
  });
const articles = (page: Page) =>
  page.$$eval('article[data-question-number]', (els) =>
    els.map((e) => Number((e as HTMLElement).dataset.questionNumber)),
  );
const mmss = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** Drive a React-controlled range input like a user drag. */
const setRange = (page: Page, label: string, value: number) =>
  page.evaluate(
    ([l, v]) => {
      const input = document.querySelector(
        `input[aria-label="${l}"]`,
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [label, value] as const,
  );

async function start(
  page: Page,
  mode: 'PRACTICE' | 'FULL_TEST',
  parts: number[] = [],
) {
  await page.goto(EXAM_PAGE, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator(`input[name="toeic-mode"][value="${mode}"]`).check();
  for (const p of parts)
    await page.locator(`input[name="toeic-part"][value="${p}"]`).check();
  await page.getByRole('button', { name: /chế độ toàn màn hình/ }).click();
  await page.waitForURL(/\/toeic\/attempts\/\d+/, { timeout: 60_000 });
  await page
    .locator('article[data-question-id]')
    .first()
    .waitFor({ timeout: 60_000 });
  return Number(/attempts\/(\d+)/.exec(page.url())?.[1]);
}

async function main() {
  const timeline = JSON.parse(
    readFileSync(
      'artifacts/toeic-listening-master/exam-1/timeline.json',
      'utf8',
    ),
  ) as {
    durationSeconds: number;
    timeline: Array<{
      kind: string;
      part?: number;
      start: number;
      end: number;
    }>;
  };
  const p2Option = (
    JSON.parse(
      harnessQuery(
        `select q.options::text from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = 1 and g.part = 2 order by q."questionNumber" limit 1`,
      )[0][0],
    ) as string[]
  )[0];

  console.log('\n== Full Test');
  const { browser, page, issues } = await studentPage('toeic-full', 1366);
  await hidePet(page);
  const ranges: number[] = [];
  page.on('response', (r) => {
    // Published object (.mp3) or the backend's local route (/audio).
    if (r.url().includes('listening-master') && /\.mp3$|\/audio$/.test(r.url()))
      ranges.push(r.status());
  });
  await page.goto(EXAM_PAGE, { waitUntil: 'networkidle', timeout: 90_000 });
  const detail = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'start screen offers "Luyện tập linh hoạt" and "Làm Full Test", no strict wording',
    detail.includes('Luyện tập linh hoạt') &&
      detail.includes('Làm Full Test') &&
      !/nghiêm ngặt|phát một lần|không tạm dừng/i.test(detail),
  );
  await page.screenshot({
    path: `${SHOTS}/toeic-start-modes.png`,
    fullPage: true,
  });
  const fullId = await start(page, 'FULL_TEST');
  await page.waitForTimeout(2500);
  check(
    'fullscreen still active after the exam opened',
    await fullscreen(page),
  );
  const tabs = await page
    .getByRole('tablist', { name: 'Part' })
    .getByRole('tab')
    .allInnerTexts();
  check(
    'seven Part tabs',
    tabs.join(',') === 'Part 1,Part 2,Part 3,Part 4,Part 5,Part 6,Part 7',
    tabs.join(','),
  );
  check(
    'Part 1 tab shows exactly questions 1-6',
    JSON.stringify(await articles(page)) === '[1,2,3,4,5,6]',
  );
  await page.getByRole('tab', { name: 'Part 2' }).click();
  const p2 = await articles(page);
  check(
    'Part 2 tab shows exactly questions 7-31',
    p2[0] === 7 && p2.at(-1) === 31 && p2.length === 25,
    `(${p2.length})`,
  );
  check(
    'Part 2 spoken answers are not printed',
    !(await page.locator('body').innerText()).includes(p2Option),
  );
  await page.locator('#q-7 input[type="radio"]').nth(1).check();
  await page.getByRole('tab', { name: 'Part 3' }).click();
  check(
    'Part 3 groups hold three questions each',
    (await page
      .locator('section[data-group-id]')
      .first()
      .locator('article')
      .count()) === 3,
  );
  await page.getByRole('tab', { name: 'Part 6' }).click();
  check(
    'Part 6: four passages, one per group',
    (await page
      .locator('section[data-group-id] p.whitespace-pre-line')
      .count()) === 4,
  );
  await page.getByRole('tab', { name: 'Part 2' }).click();
  check(
    'switching Parts keeps the Q7 answer',
    await page.locator('#q-7 input[type="radio"]').nth(1).isChecked(),
  );
  const aside = page.locator('aside');
  check(
    'sidebar has no Part buttons',
    (await aside.getByRole('button', { name: /^Part \d$/ }).count()) === 0,
  );
  const sideText = (await aside.innerText()).replace(/\s+/g, ' ');
  check(
    'sidebar order: time, submit, restore/save, review hint, numbers by Part',
    /Thời gian còn lại.*Nộp bài.*Khôi phục.*Lưu bài làm.*Chú ý: bạn có thể click vào số thứ tự câu hỏi trong bài để đánh dấu review.*Part 1/i.test(
      sideText,
    ),
  );
  check(
    'timer in minutes:seconds',
    /Thời gian còn lại: \d{2,3}:\d{2}/.test(sideText),
    sideText.slice(0, 40),
  );
  const body = await page.locator('body').innerText();
  check(
    'no "Nhóm x/54", "Đang phát" or "Nghe từ câu" controls',
    !/Nhóm \d+\/54|Đang phát|Nghe từ câu/.test(body),
  );

  await aside.getByRole('button', { name: /^Câu 150,/ }).click();
  await page.waitForTimeout(1200);
  const q150Top = await page
    .locator('#q-150')
    .evaluate((el) => el.getBoundingClientRect().top);
  check(
    'sidebar Q150 opens Part 7 and scrolls to Q150',
    (await page
      .getByRole('tab', { name: 'Part 7' })
      .getAttribute('aria-selected')) === 'true' &&
      q150Top > 0 &&
      q150Top < 500,
    `(top ${Math.round(q150Top)})`,
  );
  check('fullscreen still active after navigating', await fullscreen(page));

  console.log('\n== Listening master in Full Test');
  let a = await audioState(page);
  check(
    'one audio element with the continuous master',
    (await page.locator('audio').count()) === 1 &&
      a.src.includes('listening-master') &&
      Math.abs(a.d - timeline.durationSeconds) < 2,
    `(${a.d}s)`,
  );
  const shown = (await page.getByLabel('Thời gian audio').innerText()).trim();
  check(
    'player shows the real total duration',
    shown === `00:00 / ${mmss(timeline.durationSeconds)}`,
    shown,
  );
  check(
    'no ±10 s buttons',
    (await page.getByRole('button', { name: /10 giây/ }).count()) === 0,
  );
  await page.getByRole('button', { name: 'Phát', exact: true }).click();
  await page.waitForTimeout(3000);
  a = await audioState(page);
  check(
    'Play starts the introduction from 0:00',
    !a.paused && a.t > 1 && a.t < 6,
    `(t ${a.t.toFixed(1)})`,
  );
  await setRange(page, 'Vị trí audio', 900);
  await page.waitForTimeout(1500);
  a = await audioState(page);
  check(
    'dragging the timeline seeks (t ≈ 900 s) with Range requests',
    a.t > 899 && a.t < 905 && ranges.includes(206),
    `(t ${a.t.toFixed(1)}, ${[...new Set(ranges)].join(',')})`,
  );
  await page.getByRole('tab', { name: 'Part 5' }).click();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(2500);
  const afterTab = await audioState(page);
  check(
    'switching to Part 5 keeps the audio playing from the same place',
    !afterTab.paused &&
      afterTab.t > 900 &&
      afterTab.src.includes('listening-master'),
  );
  check(
    'playback does not scroll the page',
    (await page.evaluate(() => window.scrollY)) === scrollBefore,
  );
  await page.getByRole('button', { name: 'Tạm dừng' }).click();
  const pausedAt = (await audioState(page)).t;
  await page.waitForTimeout(1200);
  check(
    'pause holds the position',
    Math.abs((await audioState(page)).t - pausedAt) < 0.3,
  );
  await page.screenshot({ path: `${SHOTS}/toeic-paper-1366.png` });

  console.log('\n== Review flags, save, restore, reload');
  await page.getByRole('tab', { name: 'Part 1' }).click();
  await page.locator('#q-1 input[type="radio"]').nth(0).check();
  await page
    .locator('#q-1')
    .getByRole('button', { name: /Câu 1\. Bấm để đánh dấu review/ })
    .click();
  check(
    'clicking the question number flags it (sidebar shows it)',
    (await aside
      .getByRole('button', { name: /^Câu 1, .*đánh dấu review/ })
      .count()) === 1,
  );
  await aside.getByRole('button', { name: 'Lưu bài làm' }).click();
  await page.getByText(/Đã lưu bài làm lúc/).waitFor({ timeout: 15_000 });
  const savedRows = harnessQuery(
    `select q."questionNumber", a."selectedIndex" from "ToeicAttemptAnswer" a join "ToeicQuestion" q on q.id = a."questionId" where a."attemptId" = ${fullId} order by 1`,
  ).map(([n, sel]) => `${n}:${sel}`);
  check(
    '"Lưu bài làm" persisted the answers on the server',
    savedRows.includes('1:0') && savedRows.includes('7:1'),
    savedRows.join(','),
  );
  check(
    'sidebar shows the save time',
    /Bản lưu lúc \d{2}:\d{2}:\d{2}/.test(await aside.innerText()),
  );
  await page.locator('#q-1 input[type="radio"]').nth(2).check();
  await page.waitForTimeout(1500);
  await aside.getByRole('button', { name: 'Khôi phục' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Khôi phục' })
    .click();
  await page.waitForTimeout(1500);
  check(
    '"Khôi phục" brings back the saved answer A for Q1',
    await page.locator('#q-1 input[type="radio"]').nth(0).isChecked(),
  );
  check(
    'the restored answer is saved to the server again',
    harnessQuery(
      `select a."selectedIndex" from "ToeicAttemptAnswer" a join "ToeicQuestion" q on q.id = a."questionId" where a."attemptId" = ${fullId} and q."questionNumber" = 1`,
    )[0][0] === '0',
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .locator('article[data-question-id]')
    .first()
    .waitFor({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Part 1' }).click();
  check(
    'after reload the answer and the flag are back',
    (await page.locator('#q-1 input[type="radio"]').nth(0).isChecked()) &&
      (await page
        .locator('#q-1')
        .getByRole('button', { name: /đang đánh dấu review/ })
        .count()) === 1,
  );
  await page.getByRole('button', { name: /Vào toàn màn hình/ }).click();
  await page.waitForTimeout(800);
  check('one click re-enters fullscreen after reload', await fullscreen(page));

  await aside.getByRole('button', { name: 'Nộp bài' }).click();
  await page.getByRole('button', { name: 'Xác nhận nộp bài' }).click();
  await page.waitForURL(/\/toeic\/results\/\d+/, { timeout: 60_000 });
  await page.waitForTimeout(2000);
  const result = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const [lc, rc, ts] = harnessQuery(
    `select "listeningCorrect", "readingCorrect", coalesce("totalScore"::text, 'NULL') from "ToeicAttempt" where id = ${fullId}`,
  )[0];
  check(
    'Full Test result stored and shown with a converted score',
    result.includes(`${lc}/100`) &&
      result.includes(`${rc}/100`) &&
      ts !== 'NULL',
    `(L${lc} R${rc} score ${ts})`,
  );
  check(
    'no server error (Full Test)',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api')).join(' | '),
  );
  await browser.close();

  console.log('\n== Part practice: Part 2 + Part 6');
  const s = await studentPage('toeic-parts', 1920);
  await hidePet(s.page);
  const partId = await start(s.page, 'PRACTICE', [2, 6]);
  await s.page.waitForTimeout(2000);
  const ptabs = await s.page
    .getByRole('tablist', { name: 'Part' })
    .getByRole('tab')
    .allInnerTexts();
  check(
    'only the selected Parts appear (Part 2, Part 6)',
    ptabs.join(',') === 'Part 2,Part 6',
    ptabs.join(','),
  );
  const nums = await s.page
    .locator('aside')
    .getByRole('button', { name: /^Câu \d+,/ })
    .count();
  check(
    'navigator lists 25 + 16 = 41 questions with canonical numbers',
    nums === 41 &&
      (await s.page
        .locator('aside')
        .getByRole('button', { name: /^Câu 131,/ })
        .count()) === 1,
    `(${nums})`,
  );
  check(
    'server stored the Parts on the attempt',
    harnessQuery(
      `select "selectedParts"::text from "ToeicAttempt" where id = ${partId}`,
    )[0][0] === '{2,6}',
  );
  const p2Seg = timeline.timeline.filter((x) => x.part === 2);
  const p2Start = Math.min(...p2Seg.map((x) => x.start));
  const segLen = Math.max(...p2Seg.map((x) => x.end)) - p2Start;
  await s.page.waitForTimeout(1000);
  const shownPart = (
    await s.page.getByLabel('Thời gian audio').innerText()
  ).trim();
  check(
    'player length is the Part 2 segment only',
    shownPart.endsWith(mmss(segLen)),
    `${shownPart} vs ${segLen.toFixed(1)}s`,
  );
  await s.page.getByRole('button', { name: 'Phát', exact: true }).click();
  await s.page.waitForTimeout(2000);
  const ps = await audioState(s.page);
  check(
    'Part 2 audio starts at the Part 2 directions, not the exam intro',
    ps.t >= p2Start && ps.t < p2Start + 5,
    `(t ${ps.t.toFixed(1)}, start ${p2Start})`,
  );
  await s.page.locator('#q-7 input[type="radio"]').nth(0).check();
  await s.page.getByRole('tab', { name: 'Part 6' }).click();
  await s.page.locator('#q-131 input[type="radio"]').nth(0).check();
  await s.page.waitForTimeout(1500);
  const q101 = harnessQuery(
    `select q.id from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = 1 and q."questionNumber" = 101`,
  )[0][0];
  const bad = await call(
    'PATCH',
    `/toeic/attempts/${partId}/answers`,
    s.account.token,
    { answers: { [q101]: 0 } },
  );
  check(
    'server refuses an answer outside the selected Parts',
    bad.status === 400,
    `(${bad.status})`,
  );
  await s.page.screenshot({ path: `${SHOTS}/toeic-parts-1920.png` });
  await s.page
    .locator('aside')
    .getByRole('button', { name: 'Nộp bài' })
    .click();
  await s.page.getByRole('button', { name: 'Xác nhận nộp bài' }).click();
  await s.page.waitForURL(/\/toeic\/results\/\d+/, { timeout: 60_000 });
  await s.page.waitForTimeout(2000);
  const pr = (await s.page.locator('body').innerText()).replace(/\s+/g, ' ');
  const [plc, prc, pts] = harnessQuery(
    `select "listeningCorrect", "readingCorrect", coalesce("totalScore"::text, 'NULL') from "ToeicAttempt" where id = ${partId}`,
  )[0];
  check(
    'part result: scope "Luyện tập Part 2, 6", x/25 and x/16, no converted score',
    pr.includes('Luyện tập Part 2, 6') &&
      pr.includes('không quy đổi điểm') &&
      pr.includes(`${plc}/25`) &&
      pr.includes(`${prc}/16`) &&
      pts === 'NULL',
    `(L${plc} R${prc} score ${pts})`,
  );
  await s.browser.close();

  console.log('\n== Reading-only practice and mobile');
  const r = await studentPage('toeic-reading', 390);
  await hidePet(r.page);
  await start(r.page, 'PRACTICE', [6]);
  await r.page.waitForTimeout(1500);
  check(
    'reading-only practice shows no audio player',
    (await r.page.getByLabel('Vị trí audio').count()) === 0,
  );
  const overflow = await r.page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  check('no horizontal overflow at 390 px', overflow <= 1, `(${overflow}px)`);
  await r.page.getByRole('button', { name: 'Mở bảng câu hỏi' }).click();
  await r.page
    .getByRole('dialog', { name: 'Bảng câu hỏi' })
    .getByRole('button', { name: /^Câu 140,/ })
    .click();
  await r.page.waitForTimeout(1200);
  const top140 = await r.page
    .locator('#q-140')
    .evaluate((el) => el.getBoundingClientRect().top);
  check(
    'drawer jumps to Q140 on mobile',
    top140 > 0 && top140 < 600,
    `(top ${Math.round(top140)})`,
  );
  await r.page.screenshot({ path: `${SHOTS}/toeic-paper-390.png` });
  await r.browser.close();

  console.log(`\nTOEIC_PAPER_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
