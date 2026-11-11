import {
  PayOSPaymentIntentStatus,
  PlanPaymentStatus,
  PlanPurchaseStatus,
  PlanStatus,
  PlanVersionStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PlanPurchaseService } from './plan-purchase.service';
import { SubscriptionService } from './subscription.service';

// The freezes that come with a plan are tested in plan-streak-freezes.spec.ts
// and, end to end, by scripts/qa/finalization-plan-benefits.ts.
jest.mock('./plan-streak-freezes', () => ({
  grantPlanStreakFreezes: jest.fn().mockResolvedValue(0),
}));

describe('PlanPurchaseService', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const plan = {
    id: 2,
    code: 'PLUS',
    displayName: 'Plus',
    description: null,
    status: PlanStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
  const version = (
    status: PlanVersionStatus = PlanVersionStatus.PUBLISHED,
  ) => ({
    id: 12,
    planId: 2,
    version: 1,
    displayName: 'Plus monthly',
    description: null,
    durationDays: 30,
    priceVnd: 99000,
    currency: 'VND',
    status,
    isCurrent: status === PlanVersionStatus.PUBLISHED,
    effectiveFrom: now,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    plan,
    entitlements: [],
  });
  const payment = (status: PlanPaymentStatus = PlanPaymentStatus.PENDING) => ({
    id: 21,
    planPurchaseId: 31,
    amountVnd: 99000,
    currency: 'VND',
    transferCode: 'BT-PLAN-00000031',
    status,
    reportedAt: status === PlanPaymentStatus.REPORTED ? now : null,
    confirmedAt: status === PlanPaymentStatus.CONFIRMED ? now : null,
    confirmedById: status === PlanPaymentStatus.CONFIRMED ? 99 : null,
    rejectedAt: status === PlanPaymentStatus.REJECTED ? now : null,
    rejectedById: status === PlanPaymentStatus.REJECTED ? 99 : null,
    rejectionReason: status === PlanPaymentStatus.REJECTED ? 'No match' : null,
    bankBin: '970415',
    bankName: 'Test Bank',
    bankAccountNumber: '123456789',
    paymentIntentExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    autoMatchUntil: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const purchase = (
    purchaseStatus: PlanPurchaseStatus = PlanPurchaseStatus.PENDING_PAYMENT,
    paymentStatus: PlanPaymentStatus = PlanPaymentStatus.PENDING,
    subscription: object | null = null,
  ) => ({
    id: 31,
    userId: 7,
    planVersionId: 12,
    status: purchaseStatus,
    amountVnd: 99000,
    listPriceVnd: 99000,
    discountVnd: 0,
    promoCodeId: null,
    promoCode: null,
    currency: 'VND',
    durationDays: 30,
    idempotencyKey: 'key-1',
    completedAt: purchaseStatus === PlanPurchaseStatus.COMPLETED ? now : null,
    createdAt: now,
    updatedAt: now,
    user: { id: 7, email: 'student@example.com' },
    planVersion: version(
      purchaseStatus === PlanPurchaseStatus.PENDING_PAYMENT
        ? PlanVersionStatus.PUBLISHED
        : PlanVersionStatus.RETIRED,
    ),
    payment: payment(paymentStatus),
    subscription,
  });

  const makePrisma = () => ({
    planVersion: { findUnique: jest.fn() },
    planPurchase: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    planPayment: { create: jest.fn(), update: jest.fn() },
    subscription: {
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  });

  beforeAll(() => {
    process.env.PAYMENT_BANK_BIN = '970415';
    process.env.PAYMENT_BANK_NAME = 'Test Bank';
    process.env.PAYMENT_BANK_ACCOUNT_NUMBER = '123456789';
    process.env.PAYMENT_BANK_ACCOUNT_NAME = 'BREADTRANS';
  });

  it('snapshots server commercial terms and creates one payment', async () => {
    const prisma = makePrisma();
    const created = purchase();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(created),
        findUniqueOrThrow: jest.fn().mockResolvedValue(created),
      },
      planPayment: { create: jest.fn(), update: jest.fn() },
      planVersion: { findUnique: jest.fn().mockResolvedValue(version()) },
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    prisma.planVersion.findUnique.mockResolvedValue(version());
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    created.payment.transferCode = 'BTP00000031';

    const result = await service.createPurchase(7, 12, 'key-1');

    expect(result.amountVnd).toBe(99000);
    expect(result.durationDays).toBe(30);
    expect(tx.planPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 7,
        planVersionId: 12,
        amountVnd: 99000,
        durationDays: 30,
        currency: 'VND',
        idempotencyKey: 'key-1',
      }),
    });
    expect(tx.planPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        planPurchaseId: 31,
        transferCode: 'BTP00000031',
      }),
    });
    expect(result.payment.transferCode).toMatch(/^BTP[0-9]{8}$/);
    expect(result.bankInstructions!.transferCode).toBe(
      result.payment.transferCode,
    );
    expect(result.bankInstructions!.vietQrUrl).toContain(
      result.payment.transferCode,
    );
  });

  it.each([
    PayOSPaymentIntentStatus.CANCELLED,
    PayOSPaymentIntentStatus.EXPIRED,
    PayOSPaymentIntentStatus.FAILED,
    PayOSPaymentIntentStatus.PAID,
    PayOSPaymentIntentStatus.UNDERPAID,
  ])('does not keep a %s PayOS intent active', (status) => {
    const prisma = makePrisma();
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
      { isEnabled: () => true } as never,
    );
    const candidate = purchase() as any;
    candidate.payment.transferCode = 'BTP00000031';
    candidate.payment.paymentIntentExpiresAt = new Date(
      Date.now() + 60 * 60 * 1000,
    );
    candidate.payment.payosIntent = {
      status,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      checkoutUrl: 'https://payos.test/checkout',
      qrCode: 'qr',
      bankBin: '970415',
      bankAccountNumber: '123456789',
      bankAccountName: 'BREADTRANS',
    };

    expect((service as any).isActivePaymentIntent(candidate)).toBe(false);
  });

  it('keeps only a live PayOS intent resumable', () => {
    const prisma = makePrisma();
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
      { isEnabled: () => true } as never,
    );
    const candidate = purchase() as any;
    candidate.payment.transferCode = 'BTP00000031';
    candidate.payment.paymentIntentExpiresAt = new Date(
      Date.now() + 60 * 60 * 1000,
    );
    candidate.payment.payosIntent = {
      status: PayOSPaymentIntentStatus.PROCESSING,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      checkoutUrl: 'https://payos.test/checkout',
      qrCode: 'qr',
      bankBin: '970415',
      bankAccountNumber: '123456789',
      bankAccountName: 'BREADTRANS',
    };

    expect((service as any).isActivePaymentIntent(candidate)).toBe(true);
  });

  it('returns the existing logical purchase for a repeated idempotency key', async () => {
    const prisma = makePrisma();
    const existing = purchase();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: { findUnique: jest.fn().mockResolvedValue(existing) },
    };
    prisma.planVersion.findUnique.mockResolvedValue(version());
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    const result = await service.createPurchase(7, 12, 'key-1');

    expect(result.id).toBe(31);
    expect(result.payment.transferCode).toBe('BT-PLAN-00000031');
  });

  it('resumes one valid active payment intent instead of creating another purchase', async () => {
    const prisma = makePrisma();
    const active = purchase();
    active.payment = {
      ...active.payment,
      transferCode: 'BTP00000031',
      bankAccountNumber: '123456789',
      paymentIntentExpiresAt: new Date(Date.now() + 60_000),
      autoMatchUntil: new Date(Date.now() + 3_600_000),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([active]),
        create: jest.fn(),
        update: jest.fn(),
      },
      planPayment: { create: jest.fn(), update: jest.fn() },
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      planVersion: { findUnique: jest.fn() },
    };
    prisma.planVersion.findUnique.mockResolvedValue(version());
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    const result = await service.createPurchase(7, 12, 'new-key');

    expect(result.id).toBe(31);
    expect(result.payment.transferCode).toBe('BTP00000031');
    expect(tx.planPurchase.create).not.toHaveBeenCalled();
    expect(tx.planPayment.create).not.toHaveBeenCalled();
  });

  it('supersedes an active intent and creates one replacement atomically', async () => {
    const prisma = makePrisma();
    const active = purchase();
    active.payment = {
      ...active.payment,
      transferCode: 'BTP00000031',
      bankAccountNumber: '123456789',
      paymentIntentExpiresAt: new Date(Date.now() + 60_000),
      autoMatchUntil: new Date(Date.now() + 3_600_000),
    };
    const replacement = {
      ...active,
      id: 32,
      payment: {
        ...active.payment,
        id: 22,
        planPurchaseId: 32,
        transferCode: 'BTP00000032',
      },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findFirst: jest.fn().mockResolvedValue({ id: 31 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce(active)
          .mockResolvedValueOnce(replacement),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue(replacement),
        update: jest.fn(),
      },
      planPayment: { create: jest.fn(), update: jest.fn() },
      planVersion: { findFirst: jest.fn().mockResolvedValue(version()) },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    const result = await service.replacePayment(7, 31);

    expect(result.id).toBe(32);
    expect(result.payment.transferCode).toBe('BTP00000032');
    expect(tx.planPayment.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: expect.objectContaining({ status: PlanPaymentStatus.SUPERSEDED }),
    });
    expect(tx.planPurchase.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: expect.objectContaining({ status: PlanPurchaseStatus.SUPERSEDED }),
    });
    expect(tx.planPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        planPurchaseId: 32,
        transferCode: 'BTP00000032',
      }),
    });
  });

  it('rejects idempotency-key reuse for a different PlanVersion', async () => {
    const prisma = makePrisma();
    const existing = { ...purchase(), planVersionId: 12 };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: { findUnique: jest.fn().mockResolvedValue(existing) },
    };
    prisma.planVersion.findUnique.mockResolvedValue(version());
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(service.createPurchase(7, 99, 'key-1')).rejects.toThrow(
      'idempotencyKey was already used for another PlanVersion',
    );
  });

  it('scopes the same idempotency key to the authenticated student', async () => {
    const prisma = makePrisma();
    const created = purchase();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(created),
        findUniqueOrThrow: jest.fn().mockResolvedValue(created),
      },
      planPayment: { create: jest.fn(), update: jest.fn() },
      planVersion: { findUnique: jest.fn().mockResolvedValue(version()) },
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    prisma.planVersion.findUnique.mockResolvedValue(version());
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(service.createPurchase(8, 12, 'key-1')).resolves.toBeDefined();
    expect(tx.planPurchase.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_idempotencyKey: { userId: 8, idempotencyKey: 'key-1' },
        },
      }),
    );
  });

  it('does not expose another student purchase or allow transfer reporting', async () => {
    const prisma = makePrisma();
    prisma.planPurchase.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(((
      callback: (value: unknown) => unknown,
    ) =>
      callback({
        planPurchase: { findFirst: jest.fn().mockResolvedValue(null) },
      })) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(service.getMyPurchase(8, 31)).rejects.toThrow(
      'Không tìm thấy giao dịch mua gói.',
    );
    await expect(service.reportTransfer(8, 31)).rejects.toThrow(
      'Không tìm thấy giao dịch mua gói.',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('reports PENDING transfer once and keeps repeated report idempotent', async () => {
    const prisma = makePrisma();
    const current = purchase();
    const reported = purchase(
      PlanPurchaseStatus.PENDING_PAYMENT,
      PlanPaymentStatus.REPORTED,
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 31 }]),
      planPurchase: {
        findFirst: jest.fn().mockResolvedValue({ id: 31 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(reported),
      },
      planPayment: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    const result = await service.reportTransfer(7, 31);

    expect(result.payment.status).toBe(PlanPaymentStatus.REPORTED);
    expect(tx.planPayment.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: {
        status: PlanPaymentStatus.REPORTED,
        reportedAt: expect.any(Date),
      },
    });
  });

  it('confirms reported payment and creates exactly one traced Subscription', async () => {
    const prisma = makePrisma();
    const current = purchase(
      PlanPurchaseStatus.PENDING_PAYMENT,
      PlanPaymentStatus.REPORTED,
    );
    const completed = purchase(
      PlanPurchaseStatus.COMPLETED,
      PlanPaymentStatus.CONFIRMED,
      { id: 44 },
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ userId: 7 })
          .mockResolvedValueOnce(completed),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(completed),
        update: jest.fn(),
      },
      planPayment: { update: jest.fn() },
      planVersion: { findUnique: jest.fn() },
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    const result = await service.confirmPurchase(31, 99);

    expect(result.status).toBe(PlanPurchaseStatus.COMPLETED);
    expect(tx.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 7,
        planVersionId: 12,
        planPurchaseId: 31,
        status: SubscriptionStatus.ACTIVE,
      }),
    });
    expect(tx.planPayment.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: expect.objectContaining({
        status: PlanPaymentStatus.CONFIRMED,
        confirmedById: 99,
      }),
    });
    // The plan's streak freezes are given in the same transaction.
    expect(
      jest.requireMock('./plan-streak-freezes').grantPlanStreakFreezes,
    ).toHaveBeenLastCalledWith(tx, {
      userId: current.userId,
      planCode: current.planVersion.plan.code,
      durationDays: current.durationDays,
    });
  });

  describe('a learner who already has a paid plan', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const confirmWith = async (
      paidPlan: { code: string; priceVnd: number },
      endsInDays: number,
      purchasedCode = 'PLUS',
    ) => {
      const prisma = makePrisma();
      const current = purchase(
        PlanPurchaseStatus.PENDING_PAYMENT,
        PlanPaymentStatus.REPORTED,
      );
      current.planVersion = {
        ...current.planVersion,
        plan: { ...current.planVersion.plan, code: purchasedCode },
      };
      const completed = purchase(
        PlanPurchaseStatus.COMPLETED,
        PlanPaymentStatus.CONFIRMED,
        { id: 44 },
      );
      const running = {
        id: 40,
        startsAt: new Date(Date.now() - 20 * DAY),
        endsAt: new Date(Date.now() + endsInDays * DAY),
        planVersion: {
          priceVnd: paidPlan.priceVnd,
          durationDays: 30,
          plan: { code: paidPlan.code },
        },
      };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
        planPurchase: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ userId: 7 })
            .mockResolvedValueOnce(completed),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce(completed),
          update: jest.fn(),
        },
        planPayment: { update: jest.fn() },
        planVersion: { findUnique: jest.fn() },
        subscription: {
          updateMany: jest.fn(),
          findMany: jest.fn().mockResolvedValue([running]),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 45 }),
          update: jest.fn(),
        },
        subscriptionEvent: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation(((
        callback: (value: typeof tx) => unknown,
      ) => callback(tx)) as never);
      const service = new PlanPurchaseService(
        prisma as never,
        new SubscriptionService(prisma as never),
      );
      await service.confirmPurchase(31, 99);
      return { tx, running };
    };

    it('renewing the same plan queues it to start exactly when the running one ends', async () => {
      const { tx, running } = await confirmWith(
        { code: plan.code, priceVnd: 99000 },
        10,
      );
      const data = tx.subscription.create.mock.calls[0][0].data;
      expect(data.startsAt).toEqual(running.endsAt);
      expect(data.endsAt).toEqual(
        new Date(running.endsAt.getTime() + 30 * DAY),
      );
      expect(tx.subscription.update).not.toHaveBeenCalled();
      expect(
        tx.subscriptionEvent.create.mock.calls[0][0].data.metadata,
      ).toMatchObject({ placement: 'RENEW', queuedAfterSubscriptionId: 40 });
    });

    it('moving up ends the lower plan now and adds its converted days', async () => {
      // PLUS at 69,000 VND / 30 days is running; PRO (here 99,000 VND / 30 days) is bought.
      const { tx } = await confirmWith(
        { code: 'PLUS', priceVnd: 69000 },
        9,
        'PRO',
      );
      const ended = tx.subscription.update.mock.calls[0][0];
      expect(ended.where).toEqual({ id: 40 });
      const data = tx.subscription.create.mock.calls[0][0].data;
      const lengthMs = data.endsAt.getTime() - data.startsAt.getTime();
      expect(ended.data.endsAt).toEqual(data.startsAt);
      // 9 PLUS days at 2,300 VND/day are worth 6.27 PRO days at 3,300 VND/day.
      expect(lengthMs / DAY).toBeCloseTo(30 + (9 * 2300) / 3300, 2);
      expect(
        tx.subscriptionEvent.create.mock.calls[0][0].data.metadata,
      ).toMatchObject({ placement: 'UPGRADE', upgradedFromSubscriptionId: 40 });
    });

    it('a lower plan is refused while a higher one runs, before anything is written', async () => {
      await expect(
        confirmWith({ code: 'PRO', priceVnd: 149000 }, 10),
      ).rejects.toThrow('Có thể mua gói');
    });
  });

  it('accepts a frozen purchase after its version becomes RETIRED', async () => {
    const prisma = makePrisma();
    const current = purchase(
      PlanPurchaseStatus.PENDING_PAYMENT,
      PlanPaymentStatus.REPORTED,
    );
    current.planVersion.status = PlanVersionStatus.RETIRED;
    current.planVersion.isCurrent = false;
    const completed = purchase(
      PlanPurchaseStatus.COMPLETED,
      PlanPaymentStatus.CONFIRMED,
      { id: 45 },
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ userId: 7 })
          .mockResolvedValueOnce(completed),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(completed),
        update: jest.fn(),
      },
      planPayment: { update: jest.fn() },
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(service.confirmPurchase(31, 99)).resolves.toBeDefined();
    expect(tx.subscription.create).toHaveBeenCalledTimes(1);
  });

  it('does not confirm when an effective paid Subscription appeared meanwhile', async () => {
    const prisma = makePrisma();
    const current = purchase(
      PlanPurchaseStatus.PENDING_PAYMENT,
      PlanPaymentStatus.REPORTED,
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValueOnce({ userId: 7 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(current),
      },
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 55 }),
      },
      planPayment: { update: jest.fn() },
      planPurchaseUpdate: jest.fn(),
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(service.confirmPurchase(31, 99)).rejects.toThrow(
      'An effective or scheduled paid Subscription already exists',
    );
    expect(tx.subscription.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        startsAt: { lt: expect.any(Date) },
        endsAt: { gt: expect.any(Date) },
      }),
    });
    expect(tx.planPayment.update).not.toHaveBeenCalled();
  });

  it('rejects a payment whose duplicated financial snapshot was altered', async () => {
    const prisma = makePrisma();
    const current = purchase(
      PlanPurchaseStatus.PENDING_PAYMENT,
      PlanPaymentStatus.REPORTED,
    );
    current.payment.amountVnd = 1;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValueOnce({ userId: 7 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(current),
      },
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      planPayment: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(service.confirmPurchase(31, 99)).rejects.toThrow(
      'Số liệu thanh toán không khớp với giao dịch mua gói.',
    );
    expect(tx.subscription.findFirst).not.toHaveBeenCalled();
    expect(tx.planPayment.update).not.toHaveBeenCalled();
  });

  it('rejects confirmation after rejection and rejection after confirmation', async () => {
    const prisma = makePrisma();
    const rejected = purchase(
      PlanPurchaseStatus.REJECTED,
      PlanPaymentStatus.REJECTED,
    );
    const rejectedTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValueOnce({ userId: 7 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(rejected),
      },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof rejectedTx) => unknown,
    ) => callback(rejectedTx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );
    await expect(service.confirmPurchase(31, 99)).rejects.toThrow(
      'Chỉ xác nhận được khoản đã báo chuyển khoản',
    );

    const completed = purchase(
      PlanPurchaseStatus.COMPLETED,
      PlanPaymentStatus.CONFIRMED,
      { id: 44 },
    );
    const completedTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValueOnce({ userId: 7 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(completed),
      },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof completedTx) => unknown,
    ) => callback(completedTx)) as never);
    await expect(service.rejectPurchase(31, 99, 'Too late')).rejects.toThrow(
      'Không thể từ chối khoản thanh toán đã xác nhận.',
    );
  });

  it('rejects a reported payment without creating a Subscription', async () => {
    const prisma = makePrisma();
    const current = purchase(
      PlanPurchaseStatus.PENDING_PAYMENT,
      PlanPaymentStatus.REPORTED,
    );
    const rejected = purchase(
      PlanPurchaseStatus.REJECTED,
      PlanPaymentStatus.REJECTED,
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValueOnce({ userId: 7 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(rejected),
        update: jest.fn(),
      },
      planPayment: { update: jest.fn() },
      subscription: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanPurchaseService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    const result = await service.rejectPurchase(31, 99, 'No matching transfer');

    expect(result.status).toBe(PlanPurchaseStatus.REJECTED);
    expect(tx.subscription.create).not.toHaveBeenCalled();
    expect(tx.planPayment.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: expect.objectContaining({
        status: PlanPaymentStatus.REJECTED,
        rejectedById: 99,
        rejectionReason: 'No matching transfer',
      }),
    });
  });

  describe('money PayOS received after the purchase expired', () => {
    const lateTx = (current: ReturnType<typeof purchase>) => {
      const completed = purchase(
        PlanPurchaseStatus.COMPLETED,
        PlanPaymentStatus.CONFIRMED,
        { id: 44 },
      );
      return {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
        planPurchase: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ userId: 7 })
            .mockResolvedValueOnce(completed),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce(completed),
          update: jest.fn(),
        },
        planPayment: { update: jest.fn() },
        planVersion: { findUnique: jest.fn() },
        subscription: {
          updateMany: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };
    };
    const serviceWith = (tx: ReturnType<typeof lateTx>) => {
      const prisma = makePrisma();
      prisma.$transaction.mockImplementation(((
        callback: (value: typeof tx) => unknown,
      ) => callback(tx)) as never);
      return new PlanPurchaseService(
        prisma as never,
        new SubscriptionService(prisma as never),
      );
    };

    it('an admin can confirm it and the learner gets the plan', async () => {
      const tx = lateTx(
        purchase(PlanPurchaseStatus.EXPIRED, PlanPaymentStatus.REVIEW_REQUIRED),
      );

      const result = await serviceWith(tx).confirmPurchase(31, 99);

      expect(result.status).toBe(PlanPurchaseStatus.COMPLETED);
      expect(tx.subscription.create).toHaveBeenCalledTimes(1);
      expect(tx.planPurchase.update).toHaveBeenCalledWith({
        where: { id: 31 },
        data: expect.objectContaining({
          status: PlanPurchaseStatus.COMPLETED,
        }),
      });
    });

    it('is never confirmed automatically on an expired purchase', async () => {
      const tx = lateTx(
        purchase(PlanPurchaseStatus.EXPIRED, PlanPaymentStatus.EXPIRED),
      );

      await expect(
        serviceWith(tx).confirmPurchaseFromWebhook(31),
      ).rejects.toThrow('Chỉ xác nhận được khoản');
      expect(tx.subscription.create).not.toHaveBeenCalled();
    });

    it('an expired purchase whose payment is not under review stays closed to admins', async () => {
      const tx = lateTx(
        purchase(PlanPurchaseStatus.EXPIRED, PlanPaymentStatus.REPORTED),
      );

      await expect(serviceWith(tx).confirmPurchase(31, 99)).rejects.toThrow(
        'Không thể xác nhận giao dịch ở trạng thái EXPIRED.',
      );
    });

    it('an admin can reject it after refunding outside the system', async () => {
      const tx = lateTx(
        purchase(PlanPurchaseStatus.EXPIRED, PlanPaymentStatus.REVIEW_REQUIRED),
      );

      await serviceWith(tx).rejectPurchase(31, 99, 'Đã hoàn tiền');

      expect(tx.planPayment.update).toHaveBeenCalledWith({
        where: { id: 21 },
        data: expect.objectContaining({
          status: PlanPaymentStatus.REJECTED,
          rejectionReason: 'Đã hoàn tiền',
        }),
      });
      expect(tx.subscription.create).not.toHaveBeenCalled();
    });
  });
});
