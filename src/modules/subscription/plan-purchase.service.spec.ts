import {
  PlanPaymentStatus,
  PlanPurchaseStatus,
  PlanStatus,
  PlanVersionStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PlanPurchaseService } from './plan-purchase.service';
import { SubscriptionService } from './subscription.service';

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
    subscription: { findFirst: jest.fn(), create: jest.fn() },
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
        create: jest.fn().mockResolvedValue(created),
        findUniqueOrThrow: jest.fn().mockResolvedValue(created),
      },
      planPayment: { create: jest.fn(), update: jest.fn() },
      planVersion: { findUnique: jest.fn().mockResolvedValue(version()) },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
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
        transferCode: 'BT-PLAN-00000031',
      }),
    });
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
        create: jest.fn().mockResolvedValue(created),
        findUniqueOrThrow: jest.fn().mockResolvedValue(created),
      },
      planPayment: { create: jest.fn(), update: jest.fn() },
      planVersion: { findUnique: jest.fn().mockResolvedValue(version()) },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
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
      'PlanPurchase not found',
    );
    await expect(service.reportTransfer(8, 31)).rejects.toThrow(
      'PlanPurchase not found',
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
      subscription: { findFirst: jest.fn().mockResolvedValue({ id: 55 }) },
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
      subscription: { findFirst: jest.fn(), create: jest.fn() },
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
      'PlanPayment financial snapshot does not match PlanPurchase',
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
      'Only REPORTED plan payments can be confirmed',
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
      'A confirmed plan payment cannot be rejected',
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
});
