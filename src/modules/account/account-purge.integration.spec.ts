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
    await prisma.aiGenerationJob.deleteMany({
      where: { createdByAdminId: { in: ids } },
    });
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
    // The shell itself cannot be purged again.
    await expect(service.purgeUser(shell.id)).rejects.toThrow(
      'Tài khoản này đã được ẩn danh.',
    );
  });

  it('the job keeps an account whose deletion was cancelled after it was listed (audit A1)', async () => {
    // runDue listed the account, then the learner cancelled: the purge must
    // see the cancel under the row lock, not trust the list.
    const cancelled = await makeUser('cancelled', null);

    await expect(
      service.purgeUser(cancelled.id, new Date(), { onlyIfDue: true }),
    ).resolves.toBe('SKIPPED');
    expect(
      await prisma.user.findUnique({ where: { id: cancelled.id } }),
    ).not.toBeNull();
    expect(
      await prisma.profile.count({ where: { userId: cancelled.id } }),
    ).toBe(1);

    // An admin's delete still removes the account at once.
    await expect(service.purgeUser(cancelled.id)).resolves.toBe('DELETED');
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

  it('an admin with AI exam jobs leaves a shell that keeps them; running ones stop (audit A9 follow-up)', async () => {
    const admin = await makeUser('ai-admin', null);
    const other = await makeUser('ai-admin-2', null);
    await prisma.user.updateMany({
      where: { id: { in: [admin.id, other.id] } },
      data: { role: 'ADMIN' },
    });
    const job = (id: string, status: 'QUEUED' | 'PUBLISHED') => ({
      id: `purge-${id}-${suffix}`,
      createdByAdminId: admin.id,
      generationType: 'TOEIC_QUIZ' as const,
      status,
      requestSnapshot: {},
    });
    await prisma.aiGenerationJob.createMany({
      data: [job('queued', 'QUEUED'), job('published', 'PUBLISHED')],
    });

    await expect(service.purgeUser(admin.id)).resolves.toBe('ANONYMIZED');

    const shell = await prisma.user.findFirstOrThrow({
      where: { email: { startsWith: `deleted-${admin.id}-` } },
    });
    const jobs = await prisma.aiGenerationJob.findMany({
      where: { id: { startsWith: 'purge-' }, createdByAdminId: shell.id },
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
    });
    expect(jobs).toEqual([
      { id: `purge-published-${suffix}`, status: 'PUBLISHED' },
      { id: `purge-queued-${suffix}`, status: 'CANCELLED' },
    ]);
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
