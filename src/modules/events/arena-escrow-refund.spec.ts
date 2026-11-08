import { ArenaGateway } from './arena.gateway';

/**
 * A restart kills the round timers, which live in the process. Battles
 * escrowed before the boot are refunded at once, not 20 minutes later, and the
 * players are told (2026-11-08: both players lost their stake until the sweep).
 */
describe('ArenaGateway escrow refund after a restart', () => {
  const bootAt = new Date('2026-11-08T05:00:00Z');
  const battle = { id: 7, roomId: 'm-1', p1Id: 1, p2Id: 2, stake: 50 };

  const setup = (claimCount = 1) => {
    const tx = {
      gameBattle: {
        updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
      },
      userStats: {
        update: jest.fn(({ where }: { where: { userId: number } }) =>
          Promise.resolve({
            totalBanhRan: where.userId === 1 ? 150 : 250,
            user: { email: `u${where.userId}@x`, profile: null },
          }),
        ),
      },
      banhTransaction: { create: jest.fn().mockResolvedValue({}) },
      currencyTransaction: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      gameBattle: { findMany: jest.fn().mockResolvedValue([battle]) },
      $transaction: jest.fn((run: (t: typeof tx) => unknown) => run(tx)),
    };
    const store = new Map<string, string>([
      ['arena:match:m-1', '{}'],
      ['arena:user_match:1', 'm-1'],
      ['arena:user_match:2', 'other-match'],
    ]);
    const redis = {
      get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
      set: jest.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      }),
      del: jest.fn((k: string) => {
        store.delete(k);
        return Promise.resolve(1);
      }),
    };
    const eventsGateway = { sendCurrencyUpdate: jest.fn() };
    const gateway = new ArenaGateway(
      prisma as never,
      redis as never,
      eventsGateway as never,
      {} as never,
      { emit: jest.fn() } as never,
    );
    const emit = jest.fn();
    gateway.server = { to: jest.fn(() => ({ emit })) } as never;
    return { gateway, prisma, tx, store, eventsGateway, emit };
  };

  it('refunds only battles escrowed before this boot', async () => {
    const { gateway, prisma } = setup();
    await expect(gateway.refundOrphanedEscrows(bootAt)).resolves.toBe(1);
    expect(prisma.gameBattle.findMany).toHaveBeenCalledWith({
      where: { status: 'escrowed', escrowedAt: { lt: bootAt } },
    });
  });

  it('gives each player the stake back once, on the draw refund reference', async () => {
    const { gateway, tx } = setup();
    await gateway.refundEscrow(battle, 'server_restart');
    expect(tx.gameBattle.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: 'escrowed' },
      data: { status: 'cancelled', settledAt: expect.any(Date) },
    });
    const rows = tx.banhTransaction.create.mock.calls.map(
      ([arg]: [{ data: Record<string, unknown> }]) => arg.data,
    );
    expect(
      rows.map((r) => [r.userId, r.amount, r.source, r.reference]),
    ).toEqual([
      [1, 50, 'ARENA_REFUND', 'arena:match:m-1:refund:1'],
      [2, 50, 'ARENA_REFUND', 'arena:match:m-1:refund:2'],
    ]);
    expect(tx.currencyTransaction.create).toHaveBeenCalledTimes(2);
  });

  it('cleans the dead match from Redis and tells both players', async () => {
    const { gateway, store, eventsGateway, emit } = setup();
    await gateway.refundEscrow(battle, 'server_restart');
    expect(store.has('arena:match:m-1')).toBe(false);
    expect(store.has('arena:user_match:1')).toBe(false);
    // A key pointing at another match is left alone.
    expect(store.get('arena:user_match:2')).toBe('other-match');
    expect(JSON.parse(store.get('arena:aborted_notice:1')!)).toEqual({
      matchId: 'm-1',
      refunded: 50,
      reason: 'server_restart',
    });
    expect(eventsGateway.sendCurrencyUpdate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ amount: 50, newBalance: 150 }),
    );
    expect(emit).toHaveBeenCalledWith(
      'arena:match_aborted',
      expect.objectContaining({ matchId: 'm-1', refunded: 50 }),
    );
  });

  it('does nothing for a battle already settled or refunded', async () => {
    const { gateway, tx, eventsGateway, store } = setup(0);
    await expect(gateway.refundEscrow(battle, 'server_restart')).resolves.toBe(
      false,
    );
    expect(tx.banhTransaction.create).not.toHaveBeenCalled();
    expect(eventsGateway.sendCurrencyUpdate).not.toHaveBeenCalled();
    expect(store.has('arena:match:m-1')).toBe(true);
  });
});
