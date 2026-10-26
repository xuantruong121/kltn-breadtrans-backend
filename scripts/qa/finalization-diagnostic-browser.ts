/**
 * Entry Diagnostic (the ACTIVE assessment id 1, objective) in a real browser
 * on the disposable harness. Options are shuffled per learner, so answers are
 * chosen by text: the authored key for every other question, a wrong option
 * otherwise. The stored result must equal the count computed from the keys.
 */
import { call, check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const norm = (t: string) =>
  t
    .replace(/^\d+\.\s*/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function optionsOf(raw: any): string[] {
  return Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.values)
      ? raw.values
      : [];
}

async function main() {
  console.log('\n== Entry Diagnostic id 1 (browser)');
  const bank = new Map(
    harnessQuery(
      `select question, options::text, "correctIndex" from "DiagnosticQuestion" where "assessmentId" = 1`,
    ).map(([q, o, k]) => [
      norm(q),
      { options: optionsOf(JSON.parse(o)), key: Number(k) },
    ]),
  );
  const { browser, page, account, issues } = await studentPage('diag-ui');
  await page.goto(`${FE}/diagnostic`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.getByRole('button', { name: /Bắt đầu làm bài/ }).click();
  await page.waitForTimeout(3000);

  let expected = 0;
  let answered = 0;
  for (let i = 0; i < 20; i += 1) {
    const prompts = await page.locator('h1, h2, h3, p').allInnerTexts();
    // Prompts render with their number prefix ("1.").
    const prompt = prompts.map(norm).find((t) => bank.has(t));
    if (!prompt) {
      check(
        `question ${i + 1} is one of the assessment's items`,
        false,
        `(${prompts.slice(0, 4).join(' | ').slice(0, 160)})`,
      );
      break;
    }
    const item = bank.get(prompt)!;
    const keyText = item.options[item.key];
    const choice =
      i % 2 === 0 ? keyText : item.options.find((o) => o !== keyText)!;
    if (choice === keyText) expected += 1;
    await page.getByRole('button').filter({ hasText: choice }).first().click();
    answered += 1;
    await page.waitForTimeout(300);
    const next = page.getByRole('button', { name: /^Câu tiếp/ });
    if (i < 19 && (await next.isEnabled().catch(() => false)))
      await next.click();
    await page.waitForTimeout(300);
  }
  check(
    'all 20 questions answered through the UI',
    answered === 20,
    `(${answered})`,
  );
  const visible = await page.$$eval('button', (bs) =>
    bs
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => (b.textContent ?? '').trim())
      .filter(Boolean),
  );
  const finish = visible.find((t) => /Nộp|Hoàn thành|Xem kết quả/.test(t));
  check(
    'the last question offers a submit control',
    !!finish,
    `(${visible.slice(-6).join(' | ')})`,
  );
  await page
    .getByRole('button', { name: finish ?? /Nộp bài/ })
    .first()
    .click();
  const confirm = page.getByRole('button', {
    name: /^(Nộp bài|Xác nhận|Nộp)$/,
  });
  if (
    await confirm
      .nth(1)
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  )
    await confirm.nth(1).click();
  await page.waitForTimeout(5000);

  const [row] = harnessQuery(
    `select a.id, a.status, a.level from "DiagnosticAttempt" a join "User" u on u.id = a."userId" where u.email = '${account.email}' order by a.id desc limit 1`,
  );
  check(
    'the attempt is COMPLETED',
    row?.[1] === 'COMPLETED',
    `(${row?.join(' / ')})`,
  );
  const result = await call('GET', '/diagnostic/results/latest', account.token);
  check(
    'stored correct count equals the keys',
    result.data?.correctCount === expected,
    `(api ${result.data?.correctCount}, expected ${expected})`,
  );
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the result page shows that count',
    body.includes(`${expected}/20`) || body.includes(`${expected} / 20`),
    `(${expected}/20)`,
  );
  check(
    'the result page makes no CEFR claim',
    !/trình độ CEFR|CEFR (A1|A2|B1|B2|C1|C2)\b(?! -)/.test(body) ||
      /không phải chứng chỉ CEFR/.test(body),
  );
  await page.screenshot({
    path: 'artifacts/finalization/evidence/diagnostic-result.png',
    fullPage: true,
  });
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.filter((x) => x.startsWith('api 5')).join(' | '),
  );
  await browser.close();
  console.log(`\nDIAGNOSTIC_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
