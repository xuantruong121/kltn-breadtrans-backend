/**
 * The harness backend restarts in the middle of a Vocabulary Arena match
 * (owner report 2026-11-08: both players were thrown out and both lost their
 * stake until the 20-minute sweep). Expected now: at boot both stakes go back
 * at once, the dead match leaves Redis, a returning player hears why, and the
 * next search queues normally.
 *
 * Runs against the disposable harness only (BE :3101, Redis :6392,
 * harness-pg database HARNESS_DB); it restarts that backend through
 * scripts/qa/finalization-harness.sh qa-backend, never the owner's :3001.
 */
import { spawnSync } from 'child_process';
import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';

import { BE, check, failureCount, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const DB: string = process.env.HARNESS_DB ?? '';
if (!DB)
  throw new Error('set HARNESS_DB to the harness database the backend uses');
const redis = new Redis({ host: '127.0.0.1', port: 6392 });

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const once = <T = any>(s: Socket, ev: string, ms = 15_000) =>
  new Promise<T | null>((ok) => {
    const t = setTimeout(() => ok(null), ms);
    s.once(ev, (d: T) => {
      clearTimeout(t);
      ok(d);
    });
  });
const connect = (token: string): Socket =>
  io(`${BE}/arena`, {
    transports: ['websocket'],
    reconnection: false,
    auth: { token },
  });
const bread = (u: number) =>
  Number(
    harnessQuery(
      `select coalesce(max("totalBanhRan"),0) from "UserStats" where "userId" = ${u}`,
    )[0][0],
  );
const fund = (u: number, amount: number) =>
  harnessExec(
    `insert into "UserStats" ("userId","totalBanhRan") values (${u}, ${amount}) on conflict ("userId") do update set "totalBanhRan" = ${amount}`,
  );

async function backendUp(timeoutMs = 240_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${BE}/api/docs`);
      if (res.status < 500) return true;
    } catch {
      /* not listening yet */
    }
    await sleep(2000);
  }
  return false;
}

async function main() {
  const a = await newStudent('arena-restart-a');
  const b = await newStudent('arena-restart-b');
  fund(a.userId, 100);
  fund(b.userId, 100);

  const s1 = connect(a.token);
  const s2 = connect(b.token);
  await Promise.all([once(s1, 'connect'), once(s2, 'connect')]);
  const f1 = once<{
    matchId: string;
    totalRounds: number;
    questions: unknown[];
  }>(s1, 'arena:match_found');
  const f2 = once<{ matchId: string }>(s2, 'arena:match_found');
  s1.emit('join_queue', { stake: 20, gameId: 'vocab-duel' });
  await sleep(300);
  s2.emit('join_queue', { stake: 20, gameId: 'vocab-duel' });
  const [m1, m2] = await Promise.all([f1, f2]);
  const matchId = m1 && m2 && m1.matchId === m2.matchId ? m1.matchId : null;
  check('two learners matched', Boolean(matchId), String(matchId));
  if (!matchId || !m1) throw new Error('no match');
  check(
    '10 rounds, no question sent before its round',
    m1.totalRounds === 10 && m1.questions.length === 0,
    `${m1.totalRounds}/${m1.questions.length}`,
  );
  check(
    'both stakes held (80 / 80)',
    bread(a.userId) === 80 && bread(b.userId) === 80,
    `${bread(a.userId)}/${bread(b.userId)}`,
  );

  // Play round 1, then restart while round 2 runs.
  const r0 = await once<{
    roundIndex: number;
    question: { options: string[]; kind?: string };
  }>(s1, 'arena:round_start', 20_000);
  check(
    'round 1 starts with one question of a known kind',
    r0?.roundIndex === 0 &&
      r0.question.options.length === 4 &&
      Boolean(r0.question.kind),
    JSON.stringify(r0?.question.kind),
  );
  s1.emit('submit_answer', {
    matchId,
    roundIndex: 0,
    selectedOption: r0!.question.options[0],
  });
  s2.emit('submit_answer', {
    matchId,
    roundIndex: 0,
    selectedOption: r0!.question.options[1],
  });
  const r1 = await once<{ roundIndex: number }>(
    s1,
    'arena:round_start',
    20_000,
  );
  check('round 2 started', r1?.roundIndex === 1);
  s1.close();
  s2.close();

  console.log('restarting the harness backend…');
  // The restarted server keeps running; its output goes to the harness log, not here.
  const restart = spawnSync(
    'bash',
    ['scripts/qa/finalization-harness.sh', 'qa-backend', DB],
    { stdio: 'ignore' },
  );
  check(
    'harness backend restarted',
    restart.status === 0,
    String(restart.status),
  );
  check('backend answers again', await backendUp());
  await sleep(3000); // the boot refund runs right after the module starts

  check(
    'both stakes back at once (100 / 100)',
    bread(a.userId) === 100 && bread(b.userId) === 100,
    `${bread(a.userId)}/${bread(b.userId)}`,
  );
  const refunds = harnessQuery(
    `select "userId", amount, metadata->>'reason' from "BanhTransaction" where source = 'ARENA_REFUND' and reference like 'arena:match:${matchId}:refund:%' order by "userId"`,
  );
  check(
    'one ARENA_REFUND of 20 per player, reason server_restart',
    refunds.length === 2 &&
      refunds.every((r) => r[1] === '20' && r[2] === 'server_restart'),
    JSON.stringify(refunds),
  );
  const status = harnessQuery(
    `select status from "GameBattle" where "roomId" = '${matchId}'`,
  )[0]?.[0];
  check('battle cancelled', status === 'cancelled', String(status));
  const leftovers = [
    await redis.get(`arena:match:${matchId}`),
    await redis.get(`arena:user_match:${a.userId}`),
    await redis.get(`arena:user_match:${b.userId}`),
  ];
  check(
    'dead match gone from Redis',
    leftovers.every((v) => v === null),
    JSON.stringify(leftovers),
  );

  // The returning player hears what happened, once on connect.
  const back = connect(a.token);
  const notice = await once<{
    matchId: string;
    refunded: number;
    reason: string;
  }>(back, 'arena:match_aborted', 15_000);
  check(
    'returning player gets arena:match_aborted with the refund',
    notice?.matchId === matchId &&
      notice.refunded === 20 &&
      notice.reason === 'server_restart',
    JSON.stringify(notice),
  );
  // Asking to rejoin the dead match gives the same answer, not a stale state.
  const again = once(back, 'arena:match_aborted', 10_000);
  const restored = once(back, 'arena:match_state_restored', 3_000);
  back.emit('reconnect_match', { matchId });
  check(
    'reconnect_match on the dead match says it was cancelled',
    Boolean(await again) && !(await restored),
  );

  // The next search queues instead of resuming the dead match.
  const waiting = once(back, 'arena:waiting', 10_000);
  back.emit('join_queue', { stake: 20, gameId: 'vocab-duel' });
  check('next search waits in the queue', Boolean(await waiting));
  const cancelled = once(back, 'arena:cancelled', 10_000);
  back.emit('cancel_queue', {});
  check(
    'search cancelled, balance untouched',
    Boolean(await cancelled) && bread(a.userId) === 100,
  );
  back.close();

  await redis.quit();
  console.log(`\nARENA_RESTART_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR', e);
  await redis.quit().catch(() => undefined);
  process.exit(2);
});
