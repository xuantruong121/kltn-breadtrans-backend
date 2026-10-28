/**
 * Vocabulary Arena with two real learners over Socket.IO on the disposable
 * harness (BE :3101, Redis :6392, harness-pg). The test reads the match's
 * answer key from the harness Redis to steer the outcome.
 *
 *  1. win: both answer every round at the same moment (concurrency), P1 right,
 *     P2 wrong → P1 wins; stake escrow, payout and ledgers exactly once.
 *  2. reconnect + draw: P2 drops mid-match, reconnects within the grace
 *     period, state is restored; both wrong → draw, both refunded.
 *  3. forfeit: P2 drops and stays away → P1 wins by forfeit after 15 s.
 *  4. guards: no token, invalid stake, not enough Bread, double queue.
 */
import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const redis = new Redis({ host: '127.0.0.1', port: 6392 });
type Player = Awaited<ReturnType<typeof newStudent>>;

function connect(token?: string): Socket {
  return io(`${BE}/arena`, {
    transports: ['websocket'],
    reconnection: false,
    ...(token ? { auth: { token } } : {}),
  });
}
const once = <T = any>(s: Socket, ev: string, ms = 10_000) =>
  new Promise<T | null>((ok) => {
    const t = setTimeout(() => ok(null), ms);
    s.once(ev, (d: T) => {
      clearTimeout(t);
      ok(d);
    });
  });
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const bread = (u: number) =>
  Number(
    harnessQuery(
      `select coalesce(max("totalBanhRan"),0) from "UserStats" where "userId" = ${u}`,
    )[0][0],
  );
const xp = (u: number) =>
  Number(
    harnessQuery(
      `select coalesce(sum(points),0) from "PointHistory" where "userId" = ${u}`,
    )[0][0],
  );

function fund(p: Player, amount: number) {
  harnessExec(
    `insert into "UserStats" ("userId", "totalBanhRan") values (${p.userId}, ${amount}) on conflict ("userId") do update set "totalBanhRan" = ${amount}`,
  );
}

async function key(matchId: string) {
  const raw = await redis.get(`arena:match:${matchId}`);
  return raw
    ? (JSON.parse(raw).questions as Array<{
        correctAnswer: string;
        options: string[];
      }>)
    : [];
}

/** Both sockets queue; resolves with the match id seen by both. */
async function matchUp(s1: Socket, s2: Socket, stake = 10) {
  const f1 = once(s1, 'arena:match_found');
  const f2 = once(s2, 'arena:match_found');
  s1.emit('join_queue', { stake, gameId: 'vocab-duel' });
  await sleep(300);
  s2.emit('join_queue', { stake, gameId: 'vocab-duel' });
  const [m1, m2] = await Promise.all([f1, f2]);
  return m1 && m2 && m1.matchId === m2.matchId ? (m1.matchId as string) : null;
}

/** Play rounds from `from`; `pick(role, round, key)` chooses each answer. */
async function play(
  s1: Socket,
  s2: Socket,
  matchId: string,
  rounds: number[],
  pick: (
    role: 'p1' | 'p2',
    q: { correctAnswer: string; options: string[] },
  ) => string,
  results: any[],
) {
  const questions = await key(matchId);
  for (const r of rounds) {
    const start = await once(s1, 'arena:round_start', 20_000);
    if (!start || start.roundIndex !== r)
      throw new Error(
        `round ${r} did not start (${JSON.stringify(start)?.slice(0, 80)})`,
      );
    const result = once(s1, 'arena:round_result', 20_000);
    // Same tick on purpose: the two answers race on the server.
    s1.emit('submit_answer', {
      matchId,
      roundIndex: r,
      selectedOption: pick('p1', questions[r]),
    });
    s2.emit('submit_answer', {
      matchId,
      roundIndex: r,
      selectedOption: pick('p2', questions[r]),
    });
    results.push(await result);
  }
}
const right = (q: { correctAnswer: string }) => q.correctAnswer;
const wrong = (q: { correctAnswer: string; options: string[] }) =>
  q.options.find((o) => o !== q.correctAnswer)!;

async function scenarioWin(a: Player, b: Player) {
  console.log('\n== 1. Win, simultaneous answers, exactly-once payout');
  fund(a, 100);
  fund(b, 100);
  const [xpA, xpB] = [xp(a.userId), xp(b.userId)];
  const s1 = connect(a.token);
  const s2 = connect(b.token);
  await Promise.all([once(s1, 'connect'), once(s2, 'connect')]);
  const matchId = await matchUp(s1, s2, 20);
  check(
    'two learners matched (same match id on both sockets)',
    Boolean(matchId),
    String(matchId),
  );
  if (!matchId) return;
  check(
    'stake escrowed: 80 / 80',
    bread(a.userId) === 80 && bread(b.userId) === 80,
    `(${bread(a.userId)}, ${bread(b.userId)})`,
  );
  const results: any[] = [];
  const ended = once(s1, 'arena:match_ended', 120_000);
  const ended2 = once(s2, 'arena:match_ended', 120_000);
  await play(
    s1,
    s2,
    matchId,
    [0, 1, 2, 3, 4],
    (role, q) => (role === 'p1' ? right(q) : wrong(q)),
    results,
  );
  check(
    'every round records BOTH simultaneous answers (no lost update)',
    results.length === 5 &&
      results.every(
        (r) => r.p1.selectedOption !== null && r.p2.selectedOption !== null,
      ),
    JSON.stringify(
      results.map((r) => [
        r.p1.selectedOption !== null,
        r.p2.selectedOption !== null,
      ]),
    ),
  );
  check(
    'P1 right and P2 wrong in every round',
    results.every((r) => r.p1.isCorrect && !r.p2.isCorrect),
  );
  const [e1, e2] = await Promise.all([ended, ended2]);
  check(
    'both players get match_ended: winner P1, reward 40',
    e1?.winnerUserId === a.userId &&
      e2?.winnerUserId === a.userId &&
      e1?.reward === 40,
    JSON.stringify(e1)?.slice(0, 120),
  );
  await sleep(1500);
  check(
    'Bread after: winner 120, loser 80',
    bread(a.userId) === 120 && bread(b.userId) === 80,
    `(${bread(a.userId)}, ${bread(b.userId)})`,
  );
  check(
    'Arena pays Bread only: no XP history for winner or loser',
    xp(a.userId) - xpA === 0 && xp(b.userId) - xpB === 0,
    `(${xp(a.userId) - xpA}, ${xp(b.userId) - xpB})`,
  );
  const ledger = harnessQuery(
    `select source, count(*) from "BanhTransaction" where reference like 'arena:match:${matchId}:%' group by source order by source`,
  ).map(([s, n]) => `${s}=${n}`);
  check(
    'ledger: ARENA_STAKE=2, ARENA_WIN=1',
    ledger.join(',') === 'ARENA_STAKE=2,ARENA_WIN=1',
    ledger.join(','),
  );
  const battle = harnessQuery(
    `select status, "winnerUserId" from "GameBattle" where "roomId" = '${matchId}'`,
  )[0];
  check(
    'GameBattle settled with the winner',
    battle?.[0] === 'settled' && Number(battle?.[1]) === a.userId,
    JSON.stringify(battle),
  );
  const lb = await call('GET', '/gamification/leaderboard', a.token);
  check('leaderboard endpoint answers', lb.status === 200, `(${lb.status})`);
  const again = await call('GET', '/gamification/arena/snippet', a.token);
  check(
    'arena snippet endpoint answers',
    again.status === 200,
    `(${again.status})`,
  );
  s1.close();
  s2.close();
}

async function scenarioReconnectDraw(a: Player, b: Player) {
  console.log('\n== 2. Disconnect, reconnect within grace, draw refund');
  fund(a, 50);
  fund(b, 50);
  const s1 = connect(a.token);
  let s2 = connect(b.token);
  await Promise.all([once(s1, 'connect'), once(s2, 'connect')]);
  const matchId = await matchUp(s1, s2, 20);
  check('second match starts at stake 20', Boolean(matchId));
  if (!matchId) return;
  const results: any[] = [];
  await play(s1, s2, matchId, [0], (_r, q) => wrong(q), results);
  const dropped = once(s1, 'arena:opponent_disconnected', 10_000);
  s2.close();
  check(
    'opponent sees the disconnect with a grace period',
    (await dropped)?.gracePeriodSeconds === 15,
  );
  await sleep(3000);
  s2 = connect(b.token);
  await once(s2, 'connect');
  const restored = once(s2, 'arena:match_state_restored', 10_000);
  const back = once(s1, 'arena:opponent_reconnected', 10_000);
  s2.emit('reconnect_match', { matchId });
  const state = await restored;
  check(
    'returning player gets the match state (same match, round ≥ 1)',
    state?.matchId === matchId && state?.currentRound >= 1,
    JSON.stringify(state)?.slice(0, 100),
  );
  check('opponent is told the player is back', Boolean(await back));
  const ended = once(s1, 'arena:match_ended', 120_000);
  // The restored round is already running: answer it without waiting.
  const cur = state.currentRound as number;
  const qs = await key(matchId);
  const curResult = once(s1, 'arena:round_result', 20_000);
  s1.emit('submit_answer', {
    matchId,
    roundIndex: cur,
    selectedOption: wrong(qs[cur]),
  });
  s2.emit('submit_answer', {
    matchId,
    roundIndex: cur,
    selectedOption: wrong(qs[cur]),
  });
  const cr = await curResult;
  check(
    'answers after reconnect count for both players',
    cr?.roundIndex === cur &&
      cr?.p1.selectedOption !== null &&
      cr?.p2.selectedOption !== null,
    JSON.stringify(cr)?.slice(0, 90),
  );
  const rest = [1, 2, 3, 4].filter((r) => r > cur);
  await play(s1, s2, matchId, rest, (_r, q) => wrong(q), results);
  const e = await ended;
  check(
    'all wrong → draw, each refunded the stake',
    e?.isDraw === true && e?.reward === 20,
    JSON.stringify(e)?.slice(0, 100),
  );
  await sleep(1500);
  check(
    'Bread back to 50 / 50 after the draw',
    bread(a.userId) === 50 && bread(b.userId) === 50,
    `(${bread(a.userId)}, ${bread(b.userId)})`,
  );
  const ledger = harnessQuery(
    `select source, count(*) from "BanhTransaction" where reference like 'arena:match:${matchId}:%' group by source order by source`,
  ).map(([s, n]) => `${s}=${n}`);
  check(
    'ledger: ARENA_REFUND=2, ARENA_STAKE=2',
    ledger.join(',') === 'ARENA_REFUND=2,ARENA_STAKE=2',
    ledger.join(','),
  );
  s1.close();
  s2.close();
}

async function scenarioForfeit(a: Player, b: Player) {
  console.log('\n== 3. Forfeit after the 15 s grace period');
  fund(a, 30);
  fund(b, 30);
  const s1 = connect(a.token);
  const s2 = connect(b.token);
  await Promise.all([once(s1, 'connect'), once(s2, 'connect')]);
  const matchId = await matchUp(s1, s2, 20);
  if (!matchId) return check('third match starts', false);
  await once(s1, 'arena:round_start', 15_000);
  const ended = once(s1, 'arena:match_ended', 40_000);
  s2.close();
  const e = await ended;
  check(
    'absent player forfeits; present player wins',
    e?.isForfeit === true && e?.winnerUserId === a.userId,
    JSON.stringify(e)?.slice(0, 100),
  );
  await sleep(1500);
  check(
    'Bread after forfeit: 50 / 10',
    bread(a.userId) === 50 && bread(b.userId) === 10,
    `(${bread(a.userId)}, ${bread(b.userId)})`,
  );
  const n = harnessQuery(
    `select count(*) from "BanhTransaction" where reference = 'arena:match:${matchId}:reward:${a.userId}'`,
  )[0][0];
  check('forfeit reward written once', n === '1', n);
  s1.close();
}

async function guards(a: Player) {
  console.log('\n== 4. Guards');
  const anon = connect();
  const err = await once(anon, 'arena:error', 5000);
  check('connection without a token is refused', Boolean(err));
  anon.close();
  const poor = await newStudent('arena-poor');
  fund(poor, 5);
  const sp = connect(poor.token);
  await once(sp, 'connect');
  sp.emit('join_queue', { stake: 20, gameId: 'vocab-duel' });
  check(
    'not enough Bread → refused',
    /không đủ/.test((await once(sp, 'arena:error', 5000))?.message ?? ''),
  );
  sp.emit('join_queue', { stake: 10, gameId: 'vocab-duel' });
  check(
    'stake 10 (not offered by the page) → refused',
    /cược không hợp lệ/.test(
      (await once(sp, 'arena:error', 5000))?.message ?? '',
    ),
  );
  sp.emit('join_queue', { stake: 15, gameId: 'vocab-duel' });
  check(
    'stake outside 10/20/50/100 → refused',
    /cược không hợp lệ/.test(
      (await once(sp, 'arena:error', 5000))?.message ?? '',
    ),
  );
  sp.close();
  fund(a, 100);
  const s = connect(a.token);
  await once(s, 'connect');
  s.emit('join_queue', { stake: 50, gameId: 'vocab-duel' });
  await once(s, 'arena:waiting', 5000);
  s.emit('join_queue', { stake: 50, gameId: 'vocab-duel' });
  check(
    'queueing twice → refused',
    Boolean(await once(s, 'arena:error', 5000)),
  );
  const c = once(s, 'arena:cancelled', 5000);
  s.emit('cancel_queue', {});
  check(
    'cancel leaves the queue, no Bread moved',
    Boolean(await c) && bread(a.userId) === 100,
  );
  s.close();
}

async function main() {
  await redis.del(
    ...((await redis.keys('arena:queue:*')).length
      ? await redis.keys('arena:queue:*')
      : ['arena:none']),
  );
  const a = await newStudent('arena-a');
  const b = await newStudent('arena-b');
  await scenarioWin(a, b);
  await scenarioReconnectDraw(a, b);
  await scenarioForfeit(a, b);
  await guards(a);
  await redis.quit();
  console.log(`\nARENA_SOCKET_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR', e);
  await redis.quit().catch(() => undefined);
  process.exit(2);
});
