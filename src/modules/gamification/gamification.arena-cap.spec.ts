import { GamificationService } from './gamification.service';

/** A transaction double: the day's study row and the day's Arena wins in the ledger. */
function setup(opts: {
  studyEarned: number;
  arenaEarned: number;
  boostUntil?: Date | null;
}) {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, earnedBanh: opts.studyEarned }]),
    banhTransaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 9 }),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { amount: opts.arenaEarned } }),
    },
    userStats: {
      findUnique: jest.fn().mockResolvedValue({
        totalBanhRan: 500,
        doubleBanhUntil: opts.boostUntil ?? null,
      }),
      upsert: jest.fn(({ update }: any) =>
        Promise.resolve({ totalBanhRan: 500 + update.totalBanhRan.increment }),
      ),
    },
    dailyBanhEarning: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    $transaction: jest.fn((cb: (arg: any) => any) => cb(tx)),
  };
  const service = new GamificationService(
    prisma,
    { emit: jest.fn() } as any,
    {} as any,
  );
  return { service, tx };
}

describe('Arena win bonuses have their own daily cap', () => {
  it('pays a full Arena win after the 150 of study is used up, and leaves the study counter alone', async () => {
    const { service, tx } = setup({ studyEarned: 150, arenaEarned: 0 });
    const res = await service.awardBanh(
      1,
      100,
      'BLASTER_WIN',
      'blaster:1:win',
      {
        isCapped: true,
        bucket: 'ARENA',
      },
    );
    expect(res.granted).toBe(100);
    expect(res.remainingDaily).toBe(200);
    expect(tx.dailyBanhEarning.update).not.toHaveBeenCalled();
    expect(tx.banhTransaction.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 1,
        source: { in: ['BLASTER_WIN', 'DUNGEON_WIN'] },
      }),
      _sum: { amount: true },
    });
    expect(tx.banhTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 100,
        isCapped: true,
        metadata: expect.objectContaining({ capBucket: 'ARENA' }),
      }),
    });
  });

  it('cuts an Arena win at 300 a day', async () => {
    const { service } = setup({ studyEarned: 0, arenaEarned: 250 });
    const res = await service.awardBanh(
      1,
      100,
      'BLASTER_WIN',
      'blaster:2:win',
      {
        isCapped: true,
        bucket: 'ARENA',
      },
    );
    expect(res).toMatchObject({ granted: 50, rejected: 50, remainingDaily: 0 });
  });

  it('pays nothing once the Arena cap is reached', async () => {
    const { service, tx } = setup({ studyEarned: 0, arenaEarned: 300 });
    const res = await service.awardBanh(1, 20, 'DUNGEON_WIN', 'dungeon:3:win', {
      isCapped: true,
      bucket: 'ARENA',
    });
    expect(res.granted).toBe(0);
    expect(tx.banhTransaction.create).not.toHaveBeenCalled();
  });

  it('doubles an Arena win under the double-bread card, inside the 300', async () => {
    const { service } = setup({
      studyEarned: 0,
      arenaEarned: 150,
      boostUntil: new Date(Date.now() + 3_600_000),
    });
    const res = await service.awardBanh(
      1,
      100,
      'BLASTER_WIN',
      'blaster:4:win',
      {
        isCapped: true,
        bucket: 'ARENA',
      },
    );
    expect(res.granted).toBe(150);
  });

  it('study rewards still use the 150 and never read the Arena ledger', async () => {
    const { service, tx } = setup({ studyEarned: 140, arenaEarned: 300 });
    const res = await service.awardBanh(1, 40, 'DAILY_QUEST', 'quest:1', {
      isCapped: true,
    });
    expect(res.granted).toBe(10);
    expect(tx.banhTransaction.aggregate).not.toHaveBeenCalled();
    expect(tx.dailyBanhEarning.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { earnedBanh: { increment: 10 } } }),
    );
  });
});
