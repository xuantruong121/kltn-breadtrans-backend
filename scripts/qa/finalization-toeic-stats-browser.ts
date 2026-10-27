/**
 * TOEIC statistics page in real Chromium on the disposable harness.
 * A learner submits two L&R practice attempts through the API (answers from
 * the clone's keys: Q1-10 right, Q101-105 right, Q11 wrong), then opens
 * /exams → "Thống kê kết quả" and the numbers are checked against the clone.
 */
import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';

async function submitPractice(token: string, wrongExtra: boolean) {
  const start = await call('POST', '/toeic/exams/1/attempts', token, {
    mode: 'PRACTICE',
  });
  await call('POST', `/toeic/attempts/${start.data.id}/begin`, token, {});
  const keys = harnessQuery(
    `select q.id, q."questionNumber", q."correctIndex" from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = 1 and (q."questionNumber" between 1 and 11 or q."questionNumber" between 101 and 105)`,
  );
  const answers: Record<string, number> = {};
  for (const [id, n, key] of keys) {
    if (Number(n) === 11) {
      if (wrongExtra) answers[id] = (Number(key) + 1) % 3;
    } else answers[id] = Number(key);
  }
  await call('PATCH', `/toeic/attempts/${start.data.id}/answers`, token, {
    answers,
  });
  const submitted = await call(
    'POST',
    `/toeic/attempts/${start.data.id}/submit`,
    token,
    {},
  );
  return { id: start.data.id as number, status: submitted.status };
}

async function main() {
  const { browser, page, account, issues } = await studentPage(
    'toeic-stats',
    1440,
  );
  await hidePet(page);
  const a1 = await submitPractice(account.token, false);
  const a2 = await submitPractice(account.token, true);
  check(
    'two practice attempts submitted',
    a1.status < 300 && a2.status < 300,
    `(${a1.status}, ${a2.status})`,
  );

  const api = await call(
    'GET',
    '/toeic/stats/listening-reading?days=30',
    account.token,
  );
  const L = api.data.skills.LISTENING;
  check(
    'API: Listening 20 right of 200 over two tests; Part 2 has one wrong',
    L.correct === 20 &&
      L.total === 200 &&
      L.parts.find((p: any) => p.part === 2).wrong === 1,
    `(${L.correct}/${L.total})`,
  );
  const other = await call('GET', '/toeic/stats/listening-reading', undefined);
  check('API refuses a guest', other.status === 401, `(${other.status})`);

  await page.goto(`${FE}/exams`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('link', { name: /Thống kê kết quả/ }).click();
  await page.waitForURL(/\/toeic\/stats/, { timeout: 60_000 });
  await page.getByText('Số đề đã làm').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  let body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('"Thống kê kết quả" on /exams opens the statistics page', true);
  check('overview counts 2 tests', /Số đề đã làm 2 đề thi/.test(body));
  check(
    'Listening accuracy 10.00% (20/200 câu)',
    body.includes('10.00%') && body.includes('20/200 câu'),
  );
  check(
    'the page states scores are not ETS scores',
    body.includes('không phải điểm thi chính thức của ETS'),
  );
  check(
    'both attempts are listed with "Xem chi tiết"',
    (await page.getByRole('link', { name: 'Xem chi tiết' }).count()) === 2,
  );
  check(
    'accuracy chart drawn with two points',
    (await page
      .locator('svg[aria-label="Độ chính xác theo từng lần làm bài"] circle')
      .count()) === 2,
  );
  check(
    'certification tabs TOEIC and IELTS',
    (await page.getByRole('tab', { name: 'TOEIC' }).count()) === 1 &&
      (await page.getByRole('tab', { name: 'IELTS' }).count()) === 1,
  );
  await page.getByRole('tab', { name: 'Part 2' }).click();
  body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // Q7 (a When question) answered right in both tests; the other When item blank.
  check(
    'Part 2 question-type row "[Part 2] Câu hỏi When 2 0 2 50.00%"',
    body.includes('[Part 2] Câu hỏi When 2 0 2 50.00%'),
  );
  await page.screenshot({
    path: `${SHOTS}/toeic-stats-lr.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: /Xem tất cả/ }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Kết quả luyện thi: Listening',
  });
  check(
    '"Xem tất cả" opens "Kết quả luyện thi: Listening" with both tests',
    (await dialog.getByRole('link', { name: 'Xem chi tiết' }).count()) === 2,
  );
  await page.screenshot({ path: `${SHOTS}/toeic-stats-all.png` });
  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await page.getByRole('button', { name: 'Sửa điểm mục tiêu' }).click();
  await page.getByRole('spinbutton', { name: 'điểm mục tiêu' }).fill('750');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await page.waitForTimeout(1500);
  const saved = harnessQuery(
    `select "targetScore" from "Profile" where "userId" = ${account.userId}`,
  )[0][0];
  check(
    'target score saved to the profile as "TOEIC 750"',
    saved === 'TOEIC 750',
    `(${saved})`,
  );
  const bad = await call('PATCH', '/toeic/stats/goal', account.token, {
    targetScore: 777,
  });
  check(
    'an invalid target score is refused (400)',
    bad.status === 400,
    `(${bad.status})`,
  );
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('Reading tab: 10 right of 200', body.includes('10/200 câu'));
  await page.getByRole('tab', { name: 'IELTS' }).click();
  check(
    'IELTS tab says coming soon',
    (await page.locator('body').innerText()).includes('IELTS — sắp ra mắt'),
  );
  await page.goto(`${FE}/toeic/history`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  check(
    '/toeic/history redirects to the statistics page',
    page.url().includes('/toeic/stats'),
  );
  await page.setViewportSize({ width: 390, height: 860 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  check(
    'no page-level horizontal overflow at 390 px (tables scroll inside)',
    overflow <= 1,
    `(${overflow}px)`,
  );
  await page.screenshot({
    path: `${SHOTS}/toeic-stats-390.png`,
    fullPage: true,
  });
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api')).join(' | '),
  );
  await browser.close();
  console.log(`\nTOEIC_STATS_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
