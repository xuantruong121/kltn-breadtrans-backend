/**
 * Shop cosmetics over HTTP, disposable harness only (:3101): a bought frame
 * and badge are worn from the profile, survive a new sign-in, show for others
 * on the leaderboard, and cannot be worn without an order (owner 2026-11-19).
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const DB = process.env.HARNESS_DB ?? 'dev_qa';

function fund(userId: number, amount: number) {
  harnessExec(
    `insert into "UserStats" ("userId", "totalBanhRan") values (${userId}, ${amount})
     on conflict ("userId") do update set "totalBanhRan" = "UserStats"."totalBanhRan" + ${amount}`,
    DB,
  );
}

const order = (token: string, items: unknown[]) =>
  call(
    'POST',
    '/market/orders',
    token,
    { items },
    { 'idempotency-key': randomUUID() },
  );

const wear = (token: string, body: object) =>
  call('PATCH', '/users/cosmetics', token, body);

async function main() {
  console.log('\n== Shop cosmetics');
  const a = await newStudent('cos-a');
  await call('GET', '/market/currency/balance', a.token);
  fund(a.userId, 2000);

  const early = await wear(a.token, { avatarFrame: 'frame-crown' });
  check(
    'a frame cannot be worn before it is bought',
    early.status === 403,
    `(status ${early.status})`,
  );

  const odd = await wear(a.token, { avatarFrame: 'frame-made-up' });
  check(
    'a value that is not a shop frame is refused',
    odd.status === 400,
    `(status ${odd.status})`,
  );

  const bought = await order(a.token, [
    { id: 'frame-crown', quantity: 1 },
    { id: 'badge-star', quantity: 1 },
  ]);
  check(
    'buying the frame and the star badge succeeds',
    bought.status < 300,
    `(status ${bought.status})`,
  );

  const granted = harnessQuery(
    `select count(*) from "UserBadge" ub join "Badge" b on b.id = ub."badgeId"
     where ub."userId" = ${a.userId} and b.name = 'Ngôi Sao'`,
    DB,
  )[0][0];
  check(
    'buying badge-star grants the Ngôi Sao badge',
    Number(granted) === 1,
    `(rows ${granted})`,
  );

  const worn = await wear(a.token, {
    avatarFrame: 'frame-crown',
    badgeKey: 'badge-star',
  });
  check(
    'wearing owned items succeeds',
    worn.status < 300,
    `(status ${worn.status})`,
  );

  const relogin = await call('POST', '/auth/login', undefined, {
    email: a.email,
    password: a.password,
  });
  const token2 = relogin.data?.access_token as string;
  const profile = await call('GET', '/users/profile', token2);
  check(
    'after a new sign-in the profile still carries them',
    profile.data?.profile?.avatarFrame === 'frame-crown' &&
      profile.data?.profile?.badgeKey === 'badge-star',
    `(${profile.data?.profile?.avatarFrame}, ${profile.data?.profile?.badgeKey})`,
  );

  // Someone else sees them: put the learner on the leaderboard, read it as b.
  harnessExec(
    `insert into "Leaderboard" ("userId", "totalPoints", "weeklyExp", "tier") values (${a.userId}, 999999, 999999, 'Đồng')
     on conflict ("userId") do update set "totalPoints" = 999999, "weeklyExp" = 999999`,
    DB,
  );
  const b = await newStudent('cos-b');
  const board = await call(
    'GET',
    '/gamification/leaderboard?scope=all',
    b.token,
  );
  const entries = (board.data?.entries ?? board.data ?? []) as Array<
    Record<string, unknown>
  >;
  const mine = entries.find((e) => e.userId === a.userId);
  check(
    'another learner sees the frame and badge on the leaderboard',
    mine?.avatarFrame === 'frame-crown' && mine?.badgeKey === 'badge-star',
    `(${JSON.stringify(mine && { avatarFrame: mine.avatarFrame, badgeKey: mine.badgeKey })})`,
  );

  const off = await wear(token2, { avatarFrame: null, badgeKey: null });
  check(
    'null takes both off',
    off.status < 300 &&
      off.data?.avatarFrame === null &&
      off.data?.badgeKey === null,
    `(status ${off.status})`,
  );

  console.log(`\ncosmetics failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
