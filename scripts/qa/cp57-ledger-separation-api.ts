/**
 * Checkpoint 57-C: Bread and XP are separate ledgers (harness, real DB rows).
 *   - an admin Bread adjustment (+100, -50, replayed key) moves Bread and
 *     writes BanhTransaction ADMIN_ADJUSTMENT only: no PointHistory row, no
 *     Leaderboard change;
 *   - store purchase and pet feeding spend Bread without any XP effect;
 *   - a rewarded Listening practice still writes XP to PointHistory and the
 *     same amount to Leaderboard.totalPoints.
 * Arena outcomes are covered by finalization-arena-socket / -settlement.
 * Usage: npx ts-node --transpile-only scripts/qa/cp57-ledger-separation-api.ts
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const one = (sql: string) => harnessQuery(sql)[0]?.[0];
const settle = () => new Promise((ok) => setTimeout(ok, 2500));

void (async () => {
  const admin = await newAdmin('ledger-admin');
  const a = await newStudent('ledger-a');
  const snap = () => ({
    bread: Number(
      one(
        `select coalesce("totalBanhRan",0) from "UserStats" where "userId" = ${a.userId}`,
      ) ?? 0,
    ),
    xpRows: Number(
      one(`select count(*) from "PointHistory" where "userId" = ${a.userId}`),
    ),
    xpSum: Number(
      one(
        `select coalesce(sum(points),0) from "PointHistory" where "userId" = ${a.userId}`,
      ),
    ),
    total: Number(
      one(
        `select coalesce("totalPoints",0) from "Leaderboard" where "userId" = ${a.userId}`,
      ) ?? 0,
    ),
    adj: harnessQuery(
      `select amount from "BanhTransaction" where "userId" = ${a.userId} and source = 'ADMIN_ADJUSTMENT' order by id`,
    ).map((r) => Number(r[0])),
  });

  const adjust = (amount: number, key = randomUUID()) =>
    call('POST', '/market/currency/adjust', admin.token, {
      userId: a.userId,
      amount,
      reason: 'QA ledger separation',
      idempotencyKey: key,
    });

  const s0 = snap();
  const k1 = randomUUID();
  const r1 = await adjust(100, k1);
  const s1 = snap();
  check(
    'admin +100 Bread: balance +100',
    r1.status < 300 && s1.bread === s0.bread + 100,
    `(${r1.status} ${s0.bread}→${s1.bread})`,
  );
  check(
    'admin +100: one BanhTransaction ADMIN_ADJUSTMENT +100',
    JSON.stringify(s1.adj) === '[100]',
    JSON.stringify(s1.adj),
  );
  check(
    'admin +100: no PointHistory row, XP unchanged',
    s1.xpRows === s0.xpRows && s1.total === s0.total,
  );
  const r1b = await adjust(100, k1);
  const s1b = snap();
  check(
    'replayed key: applied once',
    r1b.data?.alreadyApplied === true &&
      s1b.bread === s1.bread &&
      s1b.adj.length === 1,
  );
  const r2 = await adjust(-50);
  const s2 = snap();
  check(
    'admin -50 Bread: balance -50, ledger -50, XP unchanged',
    r2.status < 300 &&
      s2.bread === s1.bread - 50 &&
      s2.adj.at(-1) === -50 &&
      s2.xpRows === s0.xpRows &&
      s2.total === s0.total,
  );
  const r3 = await adjust(-10_000);
  check(
    'overdraft refused, nothing written',
    r3.status === 400 && snap().bread === s2.bread,
    `(${r3.status})`,
  );
  check(
    'confirmation speaks of Bread only',
    !/XP|EXP|kinh nghiệm/i.test(
      String(r1.message ?? '') + JSON.stringify(r1.data ?? {}),
    ),
  );

  // Spending Bread never touches XP.
  await adjust(500); // fund the purchase; Bread only
  const beforeBuy = snap();
  const buy = await call(
    'POST',
    '/market/orders',
    a.token,
    { items: [{ id: 'streak-freeze', quantity: 1, price: 1 }] },
    { 'idempotency-key': randomUUID() },
  );
  await settle();
  const s3 = snap();
  check(
    'store purchase (Streak Freeze) spends Bread, no XP',
    buy.status < 300 &&
      s3.bread < beforeBuy.bread &&
      s3.xpRows === s0.xpRows &&
      s3.total === s0.total,
    `(${buy.status} ${beforeBuy.bread}→${s3.bread})`,
  );
  const beforeFeed = snap();
  const feed = await call('POST', '/gamification/pet/feed', a.token);
  await settle();
  const afterFeed = snap();
  check(
    'pet feeding spends Bread, no XP',
    feed.status < 300 &&
      afterFeed.bread === beforeFeed.bread - 10 &&
      afterFeed.xpRows === s0.xpRows,
    `(${feed.status})`,
  );

  // A real XP award still uses the XP ledger and the aggregate together.
  const login = await call('POST', '/auth/login', undefined, {
    email: a.email,
    password: a.password,
  });
  const token = login.data?.accessToken ?? login.data?.access_token;
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
  await call('POST', '/quizzes/9/submit', token, {
    answers,
    attemptId: att.data?.id ?? att.data?.attemptId,
  });
  await settle();
  const s4 = snap();
  check(
    'Listening practice XP: PointHistory and Leaderboard grow by the same amount',
    s4.xpSum - s0.xpSum > 0 && s4.xpSum - s0.xpSum === s4.total - s0.total,
    `(history +${s4.xpSum - s0.xpSum}, leaderboard +${s4.total - s0.total})`,
  );

  console.log(`CP57_LEDGER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
