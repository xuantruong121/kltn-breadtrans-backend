/**
 * Bảng xếp hạng on the disposable harness (owner 2026-11-08): seeds three
 * learners with values far above anyone in the clone, then checks every
 * board, the learner's own place, the hall of fame and the masked feed.
 * Runs the real SQL against harness-pg; never the owner's database.
 *
 *   HARNESS_DB=<db with migration 20261108180000> npx ts-node --transpile-only scripts/qa/finalization-ranking.ts
 */
import { call, check, failureCount, newStudent } from './harness-api';
import { harnessExec } from './harness-db';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

async function main() {
  const a = await newStudent('rank-a');
  const b = await newStudent('rank-b');
  const c = await newStudent('rank-c');
  const invitees = await Promise.all(
    [1, 2, 3].map((i) => newStudent(`rank-invitee-${i}`)),
  );
  const now = Date.now();
  const yesterdayOrToday = now - 60_000;

  // XP: A leads today, B leads this month, C leads all time; A leads this week.
  harnessExec(`insert into "PointHistory" ("userId", points, reason, "createdAt") values
    (${a.userId}, 90000, 'QA', '${iso(yesterdayOrToday)}'),
    (${b.userId}, 80000, 'QA', '${iso(yesterdayOrToday)}'),
    (${b.userId}, 70000, 'QA', '${iso(now - 3 * DAY)}'),
    (${c.userId}, 400000, 'QA', '${iso(now - 40 * DAY)}')`);
  harnessExec(`insert into "Leaderboard" ("userId", tier, "weeklyExp", "totalPoints") values
    (${a.userId}, 'Vàng', 95000, 95000),
    (${b.userId}, 'Vàng', 10, 150000),
    (${c.userId}, 'Bạc', 0, 500000)
    on conflict ("userId") do update set tier = excluded.tier, "weeklyExp" = excluded."weeklyExp", "totalPoints" = excluded."totalPoints"`);
  // Streak: B 900 days, A 800.
  harnessExec(`insert into "UserStats" ("userId", "streakCount") values (${a.userId}, 800), (${b.userId}, 900)
    on conflict ("userId") do update set "streakCount" = excluded."streakCount"`);
  // Referrals: B invited three learners who paid.
  for (const inv of invitees)
    harnessExec(
      `insert into "Referral" ("referrerId", "inviteeId", status, "rewardedAt") values (${b.userId}, ${inv.userId}, 'REWARDED', '${iso(now - DAY)}')`,
    );
  // Feed: A just reached Lv. 25.
  harnessExec(
    `insert into "LearnerEvent" ("userId", type, value, "createdAt") values (${a.userId}, 'LEVEL_UP', 25, '${iso(now)}')`,
  );

  const board = async (metric: string, period: string, token?: string) =>
    (
      await call(
        'GET',
        `/gamification/ranking?metric=${metric}&period=${period}`,
        token,
      )
    ).data;

  const today = await board('xp', 'today', a.token);
  check(
    'XP today: A first with 90.000, B second',
    today.entries[0]?.userId === a.userId &&
      today.entries[0].value === 90000 &&
      today.entries[1]?.userId === b.userId,
    JSON.stringify(today.entries.slice(0, 2)),
  );
  check(
    'my place today: rank 1, 90.000',
    today.me?.rank === 1 && today.me.value === 90000,
    JSON.stringify(today.me)?.slice(0, 160),
  );
  const month = await board('xp', 'month');
  check(
    'XP this month: B first with 150.000 (two entries)',
    month.entries[0]?.userId === b.userId && month.entries[0].value === 150000,
    JSON.stringify(month.entries[0]),
  );
  const all = await board('xp', 'all');
  check(
    'XP all time: C first with 500.000, at Lv. 100',
    all.entries[0]?.userId === c.userId &&
      all.entries[0].value === 500000 &&
      all.entries[0].level === 100,
    JSON.stringify(all.entries[0]),
  );
  const week = await board('xp', 'week', b.token);
  check(
    'XP this week: A first with 95.000',
    week.entries[0]?.userId === a.userId && week.entries[0].value === 95000,
  );
  check(
    "B's league: Vàng, behind A in the tier, XP to promotion given",
    week.me?.league?.tier === 'Vàng' &&
      week.me.league.rankInTier >= 2 &&
      typeof week.me.league.tierSize === 'number',
    JSON.stringify(week.me?.league),
  );
  const streak = await board('streak', 'all');
  check(
    'streak: B 900, A 800',
    streak.entries[0]?.userId === b.userId &&
      streak.entries[0].value === 900 &&
      streak.entries[1]?.userId === a.userId,
  );
  const referral = await board('referral', 'week');
  check(
    'referrals this week: B with 3',
    referral.entries[0]?.userId === b.userId && referral.entries[0].value === 3,
    JSON.stringify(referral.entries[0]),
  );
  const guest = await board('xp', 'today');
  check(
    'a guest sees the board without a place',
    guest.me === null && guest.entries.length > 0,
  );
  const bad = await call(
    'GET',
    '/gamification/ranking?metric=time&period=week',
  );
  check('an unknown metric is refused', bad.status === 400, String(bad.status));
  check(
    'entries carry names and levels',
    typeof today.entries[0]?.displayName === 'string' &&
      typeof today.entries[0]?.level === 'number',
  );

  const hall = (await call('GET', '/gamification/ranking/hall-of-fame')).data;
  check(
    'hall of fame: C for XP, B for streak and referrals',
    hall.xp?.userId === c.userId &&
      hall.streak?.userId === b.userId &&
      hall.referral?.userId === b.userId,
    JSON.stringify(hall).slice(0, 200),
  );

  const feed = (await call('GET', '/gamification/ranking/activity')).data as {
    name: string;
    text: string;
    kind: string;
  }[];
  check(
    "the feed shows A's level-up first, name masked",
    feed[0]?.text === 'vừa lên Lv. 25' && feed[0].name === 'Harness R.',
    JSON.stringify(feed[0]),
  );
  check(
    'no full name in the feed',
    !JSON.stringify(feed).includes('Harness rank-a'),
  );
  check('at most 15 lines', feed.length <= 15);

  console.log(`\nRANKING_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
