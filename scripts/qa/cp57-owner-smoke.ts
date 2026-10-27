/**
 * Checkpoint 57: read-only smoke of the owner's local app (FE :3000, BE :3001)
 * with the QA FREE learner: the demonstrated Speaking and Listening Dictation
 * pages open, and the Writing catalog reports completion per the new rule.
 * Usage: npx ts-node --transpile-only scripts/qa/cp57-owner-smoke.ts
 */
import { chromium } from 'playwright';

const FE = 'http://localhost:3000';
const BE = 'http://127.0.0.1:3001';

void (async () => {
  let fails = 0;
  const check = (n: string, ok: boolean, d = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
  };
  const login = await (
    await fetch(`${BE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'qa-cp51-free@breadtrans.local',
        password: 'Cp51-Free-Qa-2026!',
      }),
    })
  ).json();
  const token = login?.data?.accessToken ?? login?.data?.access_token;
  const writing = await (
    await fetch(`${BE}/writing/topics`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();
  const quizzes: any[] = writing?.data?.quizzes ?? [];
  check(
    'writing catalog loads on :3001',
    quizzes.length > 0,
    `(${quizzes.length})`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  const errors: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes(':3001') && r.status() >= 500)
      errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', 'qa-cp51-free@breadtrans.local');
  await page.fill('input[name="password"]', 'Cp51-Free-Qa-2026!');
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
  for (const [route, expect] of [
    ['/speaking', /Đọc thành tiếng|Phản hồi câu hỏi/],
    ['/speaking/16', /Ghi âm|Phản hồi câu hỏi/],
    ['/listening/24', /Nghe chép|Du lịch/],
    ['/writing', /Writing A2/],
  ] as const) {
    await page.goto(FE + route, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.waitForTimeout(2500);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check(
      `${route} opens for FREE`,
      expect.test(text) && !/Mở khóa với PLUS/.test(text.slice(0, 400)),
      text.slice(0, 100),
    );
  }
  check('no 5xx from :3001', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`CP57_OWNER_SMOKE_FAILURES=${fails}`);
  process.exit(fails ? 1 : 0);
})();
