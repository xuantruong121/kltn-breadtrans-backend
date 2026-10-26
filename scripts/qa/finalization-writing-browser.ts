/**
 * Writing practice on the disposable harness. Gemini credentials are blanked
 * there, so this verifies the failure path only: the learner writes, submits,
 * gets an honest "not graded" message, no score is stored, and the text is
 * still in the editor. Real grading is BLOCKED_EXTERNAL (needs authorized
 * Gemini calls).
 */
import { check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

async function main() {
  console.log('\n== Writing (browser, grader unavailable)');
  const { browser, page, account, issues } = await studentPage('writing-ui');
  const statuses: number[] = [];
  page.on('response', (r) => {
    if (/\/writing\/.*submit/.test(r.url())) statuses.push(r.status());
  });
  await page.goto(`${FE}/writing/3`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.waitForTimeout(2000);
  const text =
    'Dear Mr. Lee, thank you for your message about the training session. I can attend on Monday morning, ' +
    'but I need to leave before noon because I have a client meeting. Could you send me the agenda in advance? ' +
    'I would also like to know whether I should bring my laptop. Best regards, Linh';
  const editor = page.locator('textarea').first();
  await editor.fill(text);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Gửi đánh giá bài viết/ }).click();
  await page.waitForTimeout(5000);
  check(
    'the grading request failed as unavailable (503), not with a fake score',
    statuses.includes(503),
    `(${statuses.join(',')})`,
  );
  const body = await page.locator('body').innerText();
  check(
    'the learner sees that the essay was not graded',
    /không khả dụng|chưa được (lưu điểm|hoàn tất)|thử lại/i.test(body),
  );
  check(
    'the essay text is still in the editor',
    (await editor.inputValue().catch(() => '')) === text,
  );
  const [stored] = harnessQuery(
    `select count(*) from "Submission" s join "User" u on u.id = s."userId" where u.email = '${account.email}'`,
  );
  check(
    'no graded submission was stored',
    stored?.[0] === '0',
    `(${stored?.[0]})`,
  );
  await page.screenshot({
    path: 'artifacts/finalization/evidence/writing-grader-unavailable.png',
    fullPage: false,
  });
  check(
    'no unexpected 500',
    !issues.some((x) => x.startsWith('api 500')),
    issues.filter((x) => x.startsWith('api 5')).join(' | '),
  );
  await browser.close();
  console.log(`\nWRITING_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
