/**
 * Entry Diagnostic V2 skip / incomplete / resume journey in a real browser on
 * the disposable harness (same preconditions as
 * finalization-diagnostic-v2-browser.ts: clone-only activation of id 5, mock
 * grader, fake S3).
 *
 *   - answer five objective items, pause, reload, resume: the answers are kept;
 *   - skip both Speaking tasks, write Writing 1, skip Writing 2;
 *   - the pre-submit confirmation names what was skipped;
 *   - the result shows Listening/Reading, marks Speaking skipped and Writing
 *     1/2 skipped, withholds the overall, and the advice treats the missing
 *     skills as unassessed rather than weak.
 */
import { call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const EVIDENCE = 'artifacts/finalization/evidence';
const norm = (t: string) =>
  t
    .replace(/^\d+\.\s*/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const optionsOf = (raw: any): string[] =>
  Array.isArray(raw) ? raw : Array.isArray(raw?.values) ? raw.values : [];
const essay = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      [
        'I',
        'cannot',
        'come',
        'tomorrow',
        'because',
        'my',
        'shift',
        'changed',
        'so',
        'can',
        'we',
        'meet',
        'on',
        'Friday',
      ][i % 14],
  ).join(' ');

async function main() {
  console.log(
    '\n== Entry Diagnostic V2 id 5: skip / incomplete / resume (browser)',
  );
  const bank = new Map(
    harnessQuery(
      `select id, question, options::text, "correctIndex", "taskType", "wordMin" from "DiagnosticQuestion" where "assessmentId" = 5`,
    ).map(([id, q, o, k, t, wmin]) => [
      norm(q),
      {
        id: Number(id),
        options: optionsOf(JSON.parse(o)),
        key: Number(k),
        taskType: t,
        wordMin: Number(wmin) || 60,
      },
    ]),
  );
  const { browser, page, account, issues } = await studentPage('diag-v2-skip');
  await page.goto(`${FE}/diagnostic`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await hidePet(page);
  await page.getByRole('button', { name: /Bắt đầu làm bài/ }).click();
  await page.waitForTimeout(3000);

  const current = async () => {
    const prompts = await page.locator('h2').allInnerTexts();
    const prompt = prompts.map(norm).find((t) => bank.has(t));
    return prompt ? bank.get(prompt)! : null;
  };
  const answerMcq = async (item: { options: string[]; key: number }) => {
    await page
      .getByRole('button')
      .filter({ hasText: item.options[item.key] })
      .first()
      .click();
    await page.waitForTimeout(500);
  };

  // Five objective answers, then pause and come back.
  const firstFive: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const item = (await current())!;
    firstFive.push(item.options[item.key]);
    await answerMcq(item);
  }
  await page
    .getByRole('button', { name: /Tạm dừng/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^Rời đi$/ }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await hidePet(page);
  await page.getByRole('button', { name: /Tiếp tục bài đánh giá/ }).click();
  await page.waitForTimeout(3000);
  const resumedFirst = await page
    .locator('button[aria-pressed="true"]')
    .allInnerTexts();
  check(
    'resume keeps the answers given before pausing',
    resumedFirst.some((t) => t.includes(firstFive[0])),
    `(${resumedFirst.join(' | ').slice(0, 80)})`,
  );

  let writingSeen = 0;
  for (let i = 0; i < bank.size; i += 1) {
    const item = await current();
    if (!item) {
      check(`task ${i + 1} identified`, false);
      break;
    }
    const position = async () =>
      Number(
        /Câu (\d+)\/29/.exec(
          await page
            .locator('aside[aria-label="Danh sách câu hỏi"]')
            .innerText(),
        )?.[1],
      );
    if (item.taskType === 'SPEAKING_RESPONSE') {
      const before = await position();
      await page.getByRole('button', { name: /^Bỏ qua$/ }).click();
      await page.waitForFunction(
        (n) =>
          document
            .querySelector('aside[aria-label="Danh sách câu hỏi"]')
            ?.textContent?.includes(`Câu ${n}/29`),
        before + 1,
        { timeout: 10_000 },
      );
      check(
        `Speaking skip at ${before} moves straight to ${before + 1}`,
        (await position()) === before + 1,
      );
      continue;
    }
    if (item.taskType === 'WRITING_RESPONSE') {
      writingSeen += 1;
      if (writingSeen === 1) {
        await page
          .getByLabel('Câu trả lời tự luận')
          .fill(essay(item.wordMin + 5));
        await page.getByRole('button', { name: /^Câu tiếp/ }).click();
        await page.waitForTimeout(500);
      } else {
        const before = await position();
        await page.getByRole('button', { name: /^Bỏ qua$/ }).click();
        await page.waitForTimeout(500);
        check(
          `Writing skip at ${before} moves straight to ${before + 1}`,
          (await position()) === before + 1,
        );
      }
      continue;
    }
    const pressed = await page.locator('button[aria-pressed="true"]').count();
    if (pressed === 0) await answerMcq(item);
    else {
      const next = page.getByRole('button', { name: /^Câu tiếp/ });
      if (await next.isVisible().catch(() => false)) await next.click();
      await page.waitForTimeout(300);
    }
  }
  await page.getByRole('button', { name: /Hoàn thành & nộp bài/ }).click();
  const dialog = (
    await page
      .getByRole('alertdialog')
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
  check(
    'the pre-submit confirmation names the skipped tasks and the consequence',
    /2 bài Nói và 1 bài Viết/.test(dialog) &&
      /không bị tính là 0 điểm/.test(dialog) &&
      /không thể quay lại/.test(dialog),
    `(${dialog.slice(0, 160)})`,
  );
  await page.getByRole('button', { name: /Vẫn nộp bài/ }).click();
  await page.waitForTimeout(4000);

  const latest = () => call('GET', '/diagnostic/results/latest', account.token);
  let res = await latest();
  const until = Date.now() + 120_000;
  while (
    res.data?.fourSkill?.skills?.WRITING?.tasksGraded !== 1 &&
    Date.now() < until
  ) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await latest();
  }
  const fs = res.data?.fourSkill;
  check(
    'Listening and Reading are scored',
    typeof fs?.skills.LISTENING.score === 'number' &&
      typeof fs?.skills.READING.score === 'number',
    `(L ${fs?.skills.LISTENING.score}, R ${fs?.skills.READING.score})`,
  );
  check(
    'Speaking: both tasks skipped, no score, not 0',
    fs?.skills.SPEAKING.score === null &&
      fs?.skills.SPEAKING.tasksSkipped === 2,
    `(${JSON.stringify(fs?.skills.SPEAKING)})`,
  );
  check(
    'Writing: one graded, one skipped, no skill score (both tasks are required)',
    fs?.skills.WRITING.score === null &&
      fs?.skills.WRITING.tasksSkipped === 1 &&
      fs?.skills.WRITING.tasksGraded === 1,
    `(${JSON.stringify(fs?.skills.WRITING)})`,
  );
  check('overall is withheld', fs?.overall === null, `(${fs?.overall})`);
  const [row] = harnessQuery(
    `select "resultState", "overallScore", (select count(*) from "DiagnosticWritingResponse" w where w."attemptId" = a.id) from "DiagnosticAttempt" a where id = ${res.data?.attemptId}`,
  );
  check(
    'stored: no overall, and the skipped Writing task created no grading row',
    row?.[1] === '' && row?.[2] === '1',
    `(${row?.join(' / ')})`,
  );
  const advice = res.data?.advice;
  const unassessed = Object.fromEntries(
    (advice?.unassessed ?? []).map((u: any) => [u.skill, u]),
  );
  check(
    'advice: Speaking and Writing are unassessed (skipped), with general practice, never a weakness',
    unassessed.SPEAKING?.reason === 'SKIPPED' &&
      unassessed.WRITING?.reason === 'SKIPPED' &&
      !!unassessed.SPEAKING?.generalPractice &&
      !(advice?.priorities ?? []).some(
        (p: any) => p.skill === 'SPEAKING' || p.skill === 'WRITING',
      ) &&
      !(advice?.strengths ?? []).some(
        (s: any) => s.skill === 'SPEAKING' || s.skill === 'WRITING',
      ),
    `(${JSON.stringify(advice?.unassessed)})`,
  );

  await page.reload({ waitUntil: 'networkidle' });
  await hidePet(page);
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the page labels Speaking skipped and Writing partly skipped',
    text.includes('Đã bỏ qua') && text.includes('Bỏ qua 1/2 bài'),
  );
  check(
    'the page explains why there is no overall and still shows the scored skills',
    text.includes('Điểm tổng chưa có vì') &&
      !text.includes('Điểm tổng tham khảo:') &&
      text.includes(`${fs?.skills.LISTENING.score}/100`),
  );
  check(
    'the page lists unassessed skills and labels the practice as general',
    text.toLowerCase().includes('chưa đánh giá được') &&
      text
        .toLowerCase()
        .includes('luyện chung, không phải điểm yếu được chẩn đoán'),
  );
  check(
    'the skipped Writing card says it was not graded and not scored 0',
    text.includes('Bạn đã bỏ qua bài này nên bài không được chấm'),
  );
  await page.screenshot({
    path: `${EVIDENCE}/diag-v2-skip-result.png`,
    fullPage: true,
  });
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api 5')).join(' | '),
  );
  await browser.close();
  console.log(`\nDIAGNOSTIC_V2_SKIP_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
