/**
 * What each plan gives, on the disposable harness (owner 2026-11-11; numbers
 * in src/modules/subscription/plan-limits.ts).
 *
 * API: AI gradings a day (Free 10, Plus 30, Pro 60); revisions per Writing
 * answer (none, 2, 5); TOEIC Speaking & Writing and four-skill exams for Pro
 * only, Listening & Reading for everyone; streak freezes that come with a
 * granted and with a bought plan (1 per 30 days on Plus, 3 on Pro).
 * Browser: the comparison table, the lock on an exam, the upgrade line on a
 * Writing result; 1366 and 390 px.
 *
 * The daily counter is set in the harness Redis instead of grading 60
 * answers. NOT_RUN: a session started on Pro and continued after the plan
 * ended (the lock is on starting a session; plan-lock spec covers the gate).
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-plan-benefits.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  call,
  check,
  failureCount,
  newAdmin,
  newStudent,
  onboard,
} from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
const settle = () => new Promise((ok) => setTimeout(ok, 1500));
type Learner = Awaited<ReturnType<typeof newStudent>>;

const version = (code: string, days: number) =>
  Number(
    one(
      `select v.id from "PlanVersion" v join "Plan" p on p.id = v."planId" where p.code = '${code}' and v."durationDays" = ${days} and v.status = 'PUBLISHED' order by v.id desc limit 1`,
    ),
  );
const PLUS_30 = version('PLUS', 30);
const PRO_30 = version('PRO', 30);
const PRO_90 = version('PRO', 90);

const QUIZ = 17; // Writing A2, five tasks, FREE
const TASK = Number(
  one(
    `select id from "Question" where "quizId" = ${QUIZ} order by "order", id limit 1`,
  ),
);
const TEXT =
  'Hi Lan, thanks for your message. My sister ask me to meet you on Saturday at ten near the library. I will bring the notes and we can study together. See you, Minh';

/** Today's key of the AI grading counter (Vietnam day), in the harness Redis. */
const quotaKey = (u: Learner) =>
  `ai_quota:${u.userId}:${new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)}`;
const redis = (...args: string[]) =>
  execFileSync('docker', ['exec', 'harness-redis', 'redis-cli', ...args], {
    encoding: 'utf8',
  }).trim();

let admin: Awaited<ReturnType<typeof newAdmin>>;
async function grant(u: Learner, planVersionId: number, durationDays: number) {
  const res = await call('POST', '/admin/subscriptions/grant', admin.token, {
    studentId: u.userId,
    planVersionId,
    durationDays,
    reason: 'Harness QA access',
  });
  if (res.status >= 300)
    throw new Error(`grant ${res.status} ${JSON.stringify(res.message)}`);
}
const freezes = (u: Learner) =>
  Number(
    one(
      `select coalesce((select "streakFreezes" from "UserStats" where "userId" = ${u.userId}), 0)`,
    ),
  );
const freezeNotices = (u: Learner) =>
  harnessQuery(
    `select title from "Notification" where "userId" = ${u.userId} and type = 'plan_streak_freeze' order by id`,
  ).map((r) => r[0]);

const submit = (u: Learner, text: string) =>
  call('POST', `/writing/quizzes/${QUIZ}/submit`, u.token, {
    answer: text,
    questionId: TASK,
    clientAttemptId: randomUUID(),
  });
const revise = (u: Learner, id: number, text: string) =>
  call('POST', `/writing/submissions/${id}/revise`, u.token, {
    answer: text,
    clientAttemptId: randomUUID(),
  });

async function gradingLimit(u: Learner, plan: string, limit: number) {
  // One grading left today.
  redis('set', quotaKey(u), String(limit - 1), 'EX', '86400');
  const last = await submit(u, `${TEXT} (${plan} last)`);
  const over = await submit(u, `${TEXT} (${plan} over)`);
  check(
    `${plan}: grading number ${limit} of the day passes, number ${limit + 1} is refused (429)`,
    last.status < 300 && over.status === 429,
    `${last.status} then ${over.status}`,
  );
  check(
    `${plan}: the refusal names the plan and its number`,
    String(over.message).includes(`${limit} lượt AI chấm`) &&
      String(over.message).toLowerCase().includes(`gói ${plan.toLowerCase()}`),
    String(over.message),
  );
  redis('del', quotaKey(u));
}

async function api() {
  admin = await newAdmin('pb-admin');
  const free = await newStudent('pb-free');
  const plus = await newStudent('pb-plus');
  const pro = await newStudent('pb-pro');
  const pro90 = await newStudent('pb-pro90');
  for (const u of [free, plus, pro, pro90]) await onboard(u.token);

  // ------------------------------------------------ streak freezes with a plan
  await grant(plus, PLUS_30, 30);
  await grant(pro, PRO_30, 30);
  await grant(pro90, PRO_90, 90);
  check(
    'a granted plan comes with its streak freezes: Plus 1, Pro 3, Pro 90 days 9, Free 0',
    freezes(plus) === 1 &&
      freezes(pro) === 3 &&
      freezes(pro90) === 9 &&
      freezes(free) === 0,
    `${freezes(plus)}/${freezes(pro)}/${freezes(pro90)}/${freezes(free)}`,
  );
  check(
    'the learner is told once',
    JSON.stringify(freezeNotices(plus)) ===
      JSON.stringify(['Gói Plus tặng bạn 1 khiên giữ chuỗi']) &&
      JSON.stringify(freezeNotices(pro90)) ===
        JSON.stringify(['Gói Pro tặng bạn 9 khiên giữ chuỗi']) &&
      freezeNotices(free).length === 0,
    JSON.stringify([freezeNotices(plus), freezeNotices(pro90)]),
  );

  // A bought plan gives its freezes in plan-purchase.service.ts, in the
  // transaction that confirms the payment. The harness has no PayOS
  // credentials, so a purchase cannot be created here: that path is covered
  // by plan-purchase.service.spec.ts and is NOT_RUN on the harness.
  const buyer = await newStudent('pb-buyer');
  const purchase = await call('POST', '/plan-purchases', buyer.token, {
    planVersionId: PLUS_30,
    idempotencyKey: randomUUID(),
  });
  console.log(
    `NOT_RUN  streak freezes of a bought plan on the harness (purchase answered ${purchase.status}: ${String(purchase.message)})`,
  );

  // ------------------------------------------------ AI gradings a day
  await gradingLimit(free, 'Free', 10);
  await gradingLimit(plus, 'Plus', 30);
  await gradingLimit(pro, 'Pro', 60);

  // ------------------------------------------------ revisions per answer
  const f1 = Number((await submit(free, TEXT)).data?.submissionId);
  const freeRevise = await revise(
    free,
    f1,
    TEXT.replace('sister ask', 'sister asks'),
  );
  const freeView = (
    await call('GET', `/quizzes/submissions/${f1}/analytics`, free.token)
  ).data?.writingRevision;
  check(
    'Free: no revision (403, asks for Plus), and the result page is told the limit is 0',
    freeRevise.status === 403 &&
      String(freeRevise.message).includes('gói Plus và Pro') &&
      freeView?.limit === 0 &&
      freeView?.canRevise === false,
    `${freeRevise.status} ${JSON.stringify(freeRevise.message)} ${JSON.stringify(freeView)?.slice(0, 80)}`,
  );

  const reviseTimes = async (u: Learner, times: number) => {
    let id = Number((await submit(u, TEXT)).data?.submissionId);
    const statuses: number[] = [];
    for (let i = 1; i <= times; i += 1) {
      const res = await revise(u, id, `${TEXT} Revision ${i}.`);
      statuses.push(res.status);
      if (res.status < 300) id = Number(res.data?.submissionId);
    }
    return { statuses, last: await revise(u, id, `${TEXT} One more.`) };
  };
  const p = await reviseTimes(plus, 2);
  check(
    'Plus: two revisions, the third is refused (409) and points at Pro',
    p.statuses.every((s) => s < 300) &&
      p.last.status === 409 &&
      String(p.last.message).includes('Gói Pro được sửa 5 lần'),
    `${p.statuses.join(',')} then ${p.last.status} ${JSON.stringify(p.last.message)}`,
  );
  const q = await reviseTimes(pro, 5);
  check(
    'Pro: five revisions, the sixth is refused (409)',
    q.statuses.every((s) => s < 300) && q.last.status === 409,
    `${q.statuses.join(',')} then ${q.last.status}`,
  );

  // ------------------------------------------------ TOEIC exams
  const assessments = harnessQuery(
    `select id, "productFamily" from "ToeicAssessment" where "publicationStatus" = 'PUBLISHED' order by id`,
  ).map(([id, family]) => ({ id: Number(id), family }));
  const productive = assessments.filter((a) => a.family !== 'TOEIC_LR');
  check(
    'the harness has a Speaking & Writing and a four-skill exam',
    productive.some((a) => a.family === 'TOEIC_SW') &&
      productive.some((a) => a.family === 'TOEIC_4_SKILLS'),
    JSON.stringify(assessments),
  );
  for (const [u, plan] of [
    [free, 'Free'],
    [plus, 'Plus'],
  ] as const) {
    const starts = [];
    for (const a of productive)
      starts.push(
        await call('POST', `/toeic/assessments/${a.id}/attempts`, u.token, {
          idempotencyKey: randomUUID(),
        }),
      );
    const list = (await call('GET', '/toeic/assessments', u.token))
      .data as any[];
    check(
      `${plan}: a Speaking & Writing or four-skill exam cannot be started (403, asks for Pro) and is listed as locked`,
      starts.every(
        (r) => r.status === 403 && String(r.message).includes('gói Pro'),
      ) &&
        productive.every((a) => {
          const row = list.find((x) => x.id === a.id);
          return row?.isLocked === true && row?.requiredPlan === 'PRO';
        }) &&
        one(
          `select count(*) from "ToeicAssessmentAttempt" where "userId" = ${u.userId}`,
        ) === '0',
      starts.map((r) => r.status).join(','),
    );
    const lr = await call('POST', '/toeic/exams/1/attempts', u.token, {
      mode: 'FULL_TEST',
    });
    check(
      `${plan}: a Listening & Reading exam starts as before`,
      lr.status < 300 && Number(lr.data?.id) > 0,
      String(lr.status),
    );
  }
  const proStarts = [];
  for (const a of productive)
    proStarts.push(
      await call('POST', `/toeic/assessments/${a.id}/attempts`, pro.token, {
        idempotencyKey: randomUUID(),
      }),
    );
  const proList = (await call('GET', '/toeic/assessments', pro.token))
    .data as any[];
  check(
    'Pro: both exams start, and are listed as open',
    proStarts.every((r) => r.status < 300) &&
      productive.every(
        (a) => proList.find((x) => x.id === a.id)?.isLocked === false,
      ),
    proStarts.map((r) => r.status).join(','),
  );
  await settle();
}

async function browserFlow() {
  const { browser, page, account, issues } = await studentPage('pb-ui');
  await onboard(account.token);

  await page.goto(`${FE}/plans`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const table = page.locator(
    'section[aria-label="Bảng so sánh chi tiết tính năng cả 3 gói"] table',
  );
  await table.waitFor({ timeout: 60_000 });
  const rows = (await table.locator('tbody tr').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
  const row = (name: string) => rows.find((r) => r.startsWith(name)) ?? '';
  check(
    'the comparison table shows the numbers the API enforces',
    row('Bài Nói và Viết được AI chấm mỗi ngày').includes(
      '10 bài 30 bài 60 bài',
    ) &&
      row('Lượt hỏi Trợ lý Bánh Mì mỗi ngày').includes(
        '10 lượt 30 lượt 100 lượt',
      ) &&
      row('Sửa và nộp lại bài viết').includes('2 lần mỗi bài 5 lần mỗi bài') &&
      row('Khiên giữ chuỗi tặng kèm mỗi 30 ngày').includes('1 khiên 3 khiên') &&
      rows.some((r) =>
        r.startsWith('Đề TOEIC Speaking & Writing và đề 4 kỹ năng'),
      ) &&
      rows.some((r) => r.startsWith('Luyện đề TOEIC Listening & Reading')),
    rows.slice(0, 9).join(' || '),
  );
  check(
    'the "Thời hạn" row is gone',
    !rows.some((r) => r.startsWith('Thời hạn')),
  );
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${SHOTS}/plans-table-1366.png`,
    fullPage: true,
  });

  // A Free learner on a Speaking & Writing exam.
  const examId = Number(
    one(
      `select id from "Exam" where "variantCode" = 'TOEIC_SW' and "publicationStatus" = 'PUBLISHED' order by id limit 1`,
    ),
  );
  await page.goto(`${FE}/exams`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.waitForTimeout(2500);
  check(
    'the exam list tags Speaking & Writing and four-skill exams "Gói Pro"',
    (await page.getByText('Gói Pro', { exact: true }).count()) >= 2,
    String(await page.getByText('Gói Pro', { exact: true }).count()),
  );
  await page.goto(`${FE}/exams/${examId}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const upgrade = page.getByRole('button', { name: 'Nâng cấp lên Pro' });
  await upgrade
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => undefined);
  check(
    'a locked exam offers "Nâng cấp lên Pro" instead of "Bắt đầu làm bài", and says why',
    (await upgrade.count()) >= 1 &&
      (await page.getByRole('button', { name: 'Bắt đầu làm bài' }).count()) ===
        0 &&
      (await page
        .getByText('là quyền lợi của gói Pro', { exact: false })
        .count()) >= 1,
  );
  await page.screenshot({ path: `${SHOTS}/exam-locked-pro.png` });
  await upgrade.first().click();
  await page.waitForURL(/\/plans/, { timeout: 30_000 });
  check(
    'the button goes to the plans page',
    new URL(page.url()).pathname === '/plans',
  );

  // A Free learner's Writing result: an upgrade line, no revise button.
  const own = await submit(account, TEXT);
  await page.goto(
    `${FE}/writing/submissions/${Number(own.data?.submissionId)}`,
    {
      waitUntil: 'networkidle',
      timeout: 120_000,
    },
  );
  const line = page.getByText(
    'là quyền lợi của gói Plus (2 lần mỗi bài) và Pro (5 lần mỗi bài)',
    {
      exact: false,
    },
  );
  await line.waitFor({ timeout: 60_000 }).catch(() => undefined);
  check(
    'a Free Writing result shows the upgrade line and no "Sửa và nộp lại" button',
    (await line.count()) === 1 &&
      (await page.getByRole('button', { name: 'Sửa và nộp lại' }).count()) ===
        0 &&
      (await page.getByRole('link', { name: 'Xem các gói' }).count()) === 1,
  );
  await page.screenshot({
    path: `${SHOTS}/writing-result-free.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FE}/plans`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await table.waitFor({ timeout: 60_000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check(
    'the plans page has no sideways scroll at 390 px',
    overflow <= 0,
    `overflow ${overflow}`,
  );
  await page.screenshot({ path: `${SHOTS}/plans-390.png`, fullPage: true });

  check(
    'no console or network errors',
    issues.length === 0,
    issues.slice(0, 3).join(' | '),
  );
  await browser.close();
}

void (async () => {
  await api();
  await browserFlow();
  console.log(`\nFAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
