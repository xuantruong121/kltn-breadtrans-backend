import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { AccountPurgeService } from './account-purge.service';

/**
 * The purge against a real schema (owner 2026-11-16): an account without
 * orders or payments disappears; one with them leaves an anonymous shell that
 * keeps them (soft-delete rule), and the database refuses to drop an order
 * with its user.
 */
describeWithIsolatedDatabase('AccountPurgeService PostgreSQL', () => {
  const CDN = 'https://cdn.purge-test.invalid';
  let prisma: PrismaService;
  let service: AccountPurgeService;
  const r2 = {
    getPublicUrl: () => CDN,
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  const redis = {
    sadd: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    srem: jest.fn().mockResolvedValue(1),
  };
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const createdUserIds: number[] = [];

  const makeUser = async (tag: string, scheduledAt: Date | null) => {
    const user = await prisma.user.create({
      data: {
        email: `purge_${tag}_${suffix}@breadtrans.local`,
        deletionRequestedAt: scheduledAt ? new Date() : null,
        deletionScheduledAt: scheduledAt,
        profile: {
          create: {
            fullName: `Purge ${tag}`,
            avatar: `${CDN}/avatars/${tag}-${suffix}.png`,
          },
        },
        consents: {
          create: [
            { document: 'TERMS', version: '2026-11-16', method: 'PROMPT' },
          ],
        },
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  const addOrderAndLedger = async (userId: number) => {
    await prisma.marketOrder.create({
      data: {
        userId,
        studentName: 'Purge buyer',
        items: [],
        totalK: 10,
        totalBanh: 10,
      },
    });
    await prisma.banhTransaction.create({
      data: {
        userId,
        amount: -10,
        source: 'MARKET_PURCHASE',
        reference: `purge-test-${suffix}-${userId}`,
        dateKey: '2026-11-16',
        balanceAfter: 0,
      },
    });
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new AccountPurgeService(prisma, r2 as never, redis as never);
  });

  afterAll(async () => {
    const shells = await prisma.user.findMany({
      where: { email: { startsWith: 'deleted-' }, anonymizedAt: { not: null } },
      select: { id: true, email: true },
    });
    const ids = [
      ...createdUserIds,
      ...shells
        .filter((s) =>
          createdUserIds.some((id) => s.email.startsWith(`deleted-${id}-`)),
        )
        .map((s) => s.id),
    ];
    await prisma.marketOrder.deleteMany({ where: { userId: { in: ids } } });
    await prisma.banhTransaction.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  beforeEach(() => jest.clearAllMocks());

  it('deletes an account without kept records, with its files', async () => {
    const user = await makeUser('plain', new Date(Date.now() - 1000));

    await expect(service.purgeUser(user.id)).resolves.toBe('DELETED');

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.userConsent.count({ where: { userId: user.id } })).toBe(
      0,
    );
    expect(
      await prisma.user.count({
        where: { email: { startsWith: `deleted-${user.id}-` } },
      }),
    ).toBe(0);
    expect(r2.deleteFile).toHaveBeenCalledWith(`avatars/plain-${suffix}.png`);
  });

  it('keeps orders and the ledger on an anonymous shell', async () => {
    const user = await makeUser('paid', new Date(Date.now() - 1000));
    await addOrderAndLedger(user.id);

    await expect(service.purgeUser(user.id)).resolves.toBe('ANONYMIZED');

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(0);
    const shell = await prisma.user.findFirstOrThrow({
      where: { email: { startsWith: `deleted-${user.id}-` } },
      include: { profile: true },
    });
    expect(shell.anonymizedAt).not.toBeNull();
    expect(shell.password).toBeNull();
    expect(shell.profile).toBeNull();
    expect(shell.email.endsWith('@deleted.invalid')).toBe(true);
    expect(
      await prisma.marketOrder.count({ where: { userId: shell.id } }),
    ).toBe(1);
    expect(
      await prisma.banhTransaction.count({ where: { userId: shell.id } }),
    ).toBe(1);
  });

  it('runDue purges only accounts past their date', async () => {
    const due = await makeUser('due', new Date(Date.now() - 60_000));
    const later = await makeUser(
      'later',
      new Date(Date.now() + 3 * 86_400_000),
    );

    const result = await service.runDue(new Date());

    expect(result.failed).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: due.id } })).toBeNull();
    const kept = await prisma.user.findUnique({ where: { id: later.id } });
    expect(kept?.deletionScheduledAt).not.toBeNull();
    expect(await prisma.profile.count({ where: { userId: later.id } })).toBe(1);
  });

  it('the database refuses to delete a user who still has an order', async () => {
    const user = await makeUser('restrict', null);
    await addOrderAndLedger(user.id);

    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.marketOrder.count({ where: { userId: user.id } })).toBe(
      1,
    );
  });
});
