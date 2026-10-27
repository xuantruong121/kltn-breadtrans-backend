/**
 * Arena settlement exactly-once, against the disposable harness database and
 * Redis, by driving the real ArenaGateway settlement code directly:
 *
 *  - one settlement; the same settlement again; five at once;
 *  - a settlement whose transaction fails part-way, then a retry;
 *  - a draw refund replayed; a forfeit replayed;
 *  - an escrow left behind by a restart (no live match) refunded once,
 *    and a live escrow left alone.
 * Persisted balances, XP, ledger rows and GameBattle state are asserted.
 */
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import { ArenaGateway } from '../../src/modules/events/arena.gateway';
import { check, failureCount, newStudent } from './harness-api';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://harness:harness-disposable@127.0.0.1:5460/harness_clone',
    },
  },
});
const redis = new Redis({ host: '127.0.0.1', port: 6392 });
const events = { sendCurrencyUpdate: () => undefined };
const gw = new ArenaGateway(prisma, redis, events as any, {} as any);
(gw as any).server = { to: () => ({ emit: () => true }) };
const finalize = (m: any, w: 'p1' | 'p2' | 'draw', forfeit = false) =>
  (gw as any)
    .finalizeMatch(JSON.parse(JSON.stringify(m)), w, forfeit)
    .catch((e: Error) => e.message);

async function state(u: number) {
  const s = await prisma.userStats.findUnique({ where: { userId: u } });
  const xp = await prisma.pointHistory.aggregate({
    where: { userId: u },
    _sum: { points: true },
  });
  return { bread: s?.totalBanhRan ?? 0, xp: xp._sum.points ?? 0 };
}
const ledger = async (roomId: string) =>
  (
    await prisma.banhTransaction.groupBy({
      by: ['source'],
      where: { reference: { startsWith: `arena:match:${roomId}:` } },
      _count: true,
      orderBy: { source: 'asc' },
    })
  )
    .map((r) => `${r.source}=${r._count}`)
    .join(',');

/** An escrowed match exactly as tryMatchPlayers leaves it (stakes taken). */
async function escrowed(p1: number, p2: number, stake: number, ageMs = 0) {
  const roomId = `match_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  for (const u of [p1, p2])
    await prisma.userStats.upsert({
      where: { userId: u },
      create: { userId: u, totalBanhRan: 100 - stake },
      update: { totalBanhRan: 100 - stake },
    });
  await prisma.gameBattle.create({
    data: {
      roomId,
      gameId: 'vocab-duel',
      p1Id: p1,
      p2Id: p2,
      stake,
      status: 'escrowed',
      escrowedAt: new Date(Date.now() - ageMs),
    },
  });
  const player = (userId: number) => ({
    userId,
    socketId: 'x',
    userName: `u${userId}`,
    score: 0,
    isDisconnected: false,
    answers: {},
  });
  return {
    matchId: roomId,
    stake,
    gameId: 'vocab-duel',
    status: 'in_progress',
    currentRound: 4,
    totalRounds: 5,
    roundStartTime: 0,
    roundDuration: 15,
    p1: player(p1),
    p2: player(p2),
    questions: [],
    isSettled: false,
    createdAt: Date.now(),
  };
}

async function main() {
  const a = (await newStudent('arena-settle-a')).userId;
  const b = (await newStudent('arena-settle-b')).userId;
  const xp0 = [(await state(a)).xp, (await state(b)).xp];

  console.log('\n== Win: once, again, five at once');
  const m1 = await escrowed(a, b, 20);
  await finalize(m1, 'p1');
  const again = await finalize(m1, 'p1');
  const burst = await Promise.all(
    Array.from({ length: 5 }, () => finalize(m1, 'p1')),
  );
  const [sa, sb] = [await state(a), await state(b)];
  check(
    'winner 120 / loser 80 after 7 settlement calls',
    sa.bread === 120 && sb.bread === 80,
    `(${sa.bread}, ${sb.bread})`,
  );
  check(
    'winner XP +40 exactly once, loser +0',
    sa.xp - xp0[0] === 40 && sb.xp - xp0[1] === 0,
    `(${sa.xp - xp0[0]}, ${sb.xp - xp0[1]})`,
  );
  check(
    'ledger: one ARENA_WIN',
    (await ledger(m1.matchId)) === 'ARENA_WIN=1',
    await ledger(m1.matchId),
  );
  check(
    'replays are refused, not paid',
    [again, ...burst].every(
      (r) => r === undefined || /ALREADY_SETTLED/.test(String(r)),
    ),
    JSON.stringify([again, ...burst]),
  );
  const g1 = await prisma.gameBattle.findUnique({
    where: { roomId: m1.matchId },
  });
  check(
    'GameBattle settled with the winner',
    g1?.status === 'settled' && g1.winnerUserId === a,
  );

  console.log('\n== Failure part-way, then retry');
  const m2 = await escrowed(a, b, 10);
  const winnerStats = await prisma.userStats.findUnique({
    where: { userId: a },
  });
  await prisma.userStats.delete({ where: { userId: a } }); // the payout update will throw
  const failed = await finalize(m2, 'p1');
  const g2 = await prisma.gameBattle.findUnique({
    where: { roomId: m2.matchId },
  });
  check(
    'failed settlement rolls back: still escrowed, no ledger row',
    g2?.status === 'escrowed' && (await ledger(m2.matchId)) === '',
    `(${String(failed).slice(0, 60)})`,
  );
  await prisma.userStats.create({
    data: { userId: a, totalBanhRan: winnerStats!.totalBanhRan },
  });
  await redis.del(`arena:lock:settle:${m2.matchId}`);
  await finalize(m2, 'p1');
  check(
    'retry settles once: winner +20, ARENA_WIN=1',
    (await state(a)).bread === winnerStats!.totalBanhRan + 20 &&
      (await ledger(m2.matchId)) === 'ARENA_WIN=1',
  );

  console.log('\n== Draw refund replayed; forfeit replayed');
  const m3 = await escrowed(a, b, 50);
  await Promise.all([
    finalize(m3, 'draw'),
    finalize(m3, 'draw'),
    finalize(m3, 'draw'),
  ]);
  check(
    'draw: both back to 100, two ARENA_REFUND rows',
    (await state(a)).bread === 100 &&
      (await state(b)).bread === 100 &&
      (await ledger(m3.matchId)) === 'ARENA_REFUND=2',
  );
  const m4 = await escrowed(a, b, 10);
  await Promise.all([finalize(m4, 'p2', true), finalize(m4, 'p2', true)]);
  check(
    'forfeit: opponent paid once (110 / 90), ARENA_WIN=1',
    (await state(b)).bread === 110 &&
      (await state(a)).bread === 90 &&
      (await ledger(m4.matchId)) === 'ARENA_WIN=1',
  );

  console.log('\n== Escrow orphaned by a restart');
  const dead = await escrowed(a, b, 20, 25 * 60_000);
  const live = await escrowed(a, b, 20, 60_000);
  const [n1, n2] = await Promise.all([
    gw.refundStaleEscrows(),
    gw.refundStaleEscrows(),
  ]);
  const gd = await prisma.gameBattle.findUnique({
    where: { roomId: dead.matchId },
  });
  const gl = await prisma.gameBattle.findUnique({
    where: { roomId: live.matchId },
  });
  check(
    'stale escrow refunded once across two concurrent sweeps',
    n1 + n2 >= 1 &&
      gd?.status === 'cancelled' &&
      (await ledger(dead.matchId)) === 'ARENA_REFUND=2',
    `(${n1}+${n2}, ${gd?.status}, ${await ledger(dead.matchId)})`,
  );
  check(
    'a recent escrow (live match) is left alone',
    gl?.status === 'escrowed' && (await ledger(live.matchId)) === '',
  );
  check(
    'both players got the stale stake back (80 + 20 = 100)',
    (await state(a)).bread === 100 && (await state(b)).bread === 100,
    `(${(await state(a)).bread}, ${(await state(b)).bread})`,
  );
  const late = await finalize(dead, 'p1');
  check(
    'a late settlement of the refunded match pays nothing',
    /ALREADY_SETTLED/.test(String(late)) &&
      (await ledger(dead.matchId)) === 'ARENA_REFUND=2',
    String(late),
  );
  await prisma.gameBattle.update({
    where: { roomId: live.matchId },
    data: { status: 'cancelled' },
  });

  await prisma.$disconnect();
  await redis.quit();
  console.log(`\nARENA_SETTLEMENT_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR', e);
  await prisma.$disconnect();
  await redis.quit();
  process.exit(2);
});
