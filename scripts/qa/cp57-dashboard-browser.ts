/**
 * Checkpoint 57: the learner dashboard and pet page show the same XP / Bread
 * the ledger holds, after a rewarded Listening practice (harness).
 * Usage: npx ts-node --transpile-only scripts/qa/cp57-dashboard-browser.ts
 */
import { call, check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const one = (sql: string) => harnessQuery(sql)[0]?.[0];

void (async () => {
  const { browser, page, account, issues } = await studentPage('cp57-dash');
  const login = await call('POST', '/auth/login', undefined, {
    email: account.email,
    password: account.password,
  });
  const token = login.data?.accessToken ?? login.data?.access_token;
  // Earn a reward: complete the FREE A1 listening quiz 9 with every key.
  const qs = harnessQuery(
    `select id, content::text from "Question" where "quizId" = 9 order by "order", id`,
  );
  const answers = qs.map(([id, raw]) => {
    const c = JSON.parse(raw);
    return {
      questionId: Number(id),
      answer: Array.isArray(c.options) ? c.options[c.correctIndex] : c.correct,
    };
  });
  const att = await call('POST', '/quizzes/9/listening-attempts', token);
  const sub = await call('POST', '/quizzes/9/submit', token, {
    answers,
    attemptId: att.data?.id ?? att.data?.attemptId,
  });
  check('listening practice submitted', sub.status < 300, `(${sub.status})`);
  await page.waitForTimeout(4000);
  const xp = Number(
    one(
      `select coalesce(sum(points),0) from "PointHistory" where "userId" = ${account.userId}`,
    ),
  );
  const bread = Number(
    one(
      `select coalesce("totalBanhRan",0) from "UserStats" where "userId" = ${account.userId}`,
    ),
  );
  check(
    'the practice was rewarded (ledger)',
    xp > 0 && bread > 0,
    `(xp ${xp}, bread ${bread})`,
  );

  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${FE}/dashboard`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(2500);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const nums = (text.match(/\d[\d.,]*/g) ?? []).map((n) =>
      Number(n.replace(/[.,]/g, '')),
    );
    check(
      `@${width} dashboard shows the ledger XP (${xp})`,
      nums.includes(xp),
      text.slice(0, 160),
    );
    check(
      `@${width} dashboard shows the Bread balance (${bread})`,
      nums.includes(bread),
    );
    await page.screenshot({
      path: `artifacts/finalization/evidence/cp57-dashboard-${width}.png`,
      fullPage: false,
    });
  }
  // Recent activity lives in the account hub (Tiến độ học tập) and names the
  // exercise, with the activity type and result underneath.
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${FE}/hub?tab=learning-progress`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(2500);
    const hub = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const at = hub.indexOf('Hoạt động gần đây');
    const recent = hub.slice(Math.max(at, 0));
    check(
      `@${width} recent activity names the exercise and its result`,
      at >= 0 &&
        recent.includes('Listening A1 — Essential Everyday English') &&
        recent.includes('Luyện nghe hiểu · 8/8 câu đúng'),
      recent.slice(0, 200),
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    check(`@${width} no horizontal overflow`, overflow <= 1, `(${overflow}px)`);
    await page.screenshot({
      path: `artifacts/finalization/evidence/cp57-recent-activity-${width}.png`,
      fullPage: false,
    });
  }
  await page.goto(`${FE}/pet`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(1500);
  const petText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'pet page shows the same Bread balance',
    new RegExp(`Số dư:\\s*${bread}\\b`).test(petText),
    petText.match(/Số dư:[^B]*/)?.[0] ?? '',
  );
  check(
    'no server errors',
    !issues.some((x) => x.startsWith('api 5')),
    issues.join(' | '),
  );
  await browser.close();
  console.log(`CP57_DASHBOARD_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
