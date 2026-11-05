import { ConflictException } from '@nestjs/common';
import { PlanPaymentStatus, PlanPurchaseStatus } from '@prisma/client';
import { PlanPurchaseService } from './plan-purchase.service';
import { StalePurchaseScheduler } from './stale-purchase.scheduler';

/**
 * The five-minute sweep that closes purchases whose payment window passed.
 * Nothing changes on a PayOS order until PayOS has been asked; money that
 * cannot be applied waits for an admin instead of being dropped.
 */
describe('PlanPurchaseService.expireStalePurchases', () => {
  const now = new Date('2026-11-05T05:00:00.000Z');

  const stored = (
    status: PlanPurchaseStatus = PlanPurchaseStatus.PENDING_PAYMENT,
    paymentStatus: PlanPaymentStatus = PlanPaymentStatus.PENDING,
  ) => ({
    id: 31,
    userId: 7,
    status,
    payment: { id: 21, status: paymentStatus },
  });

  const setup = (options: {
    orderCode?: bigint | null;
    current?: ReturnType<typeof stored>;
    payosEnabled?: boolean;
    closeUnpaid?: jest.Mock;
  }) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValue({ userId: 7 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(options.current ?? stored()),
        update: jest.fn(),
      },
      planPayment: { update: jest.fn() },
    };
    const prisma = {
      planPurchase: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 31,
            payment: {
              payosIntent:
                options.orderCode === null
                  ? null
                  : { orderCode: options.orderCode ?? BigInt(1762318800031) },
            },
          },
        ]),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const payos = {
      isEnabled: jest.fn().mockReturnValue(options.payosEnabled ?? true),
      closeUnpaid: options.closeUnpaid ?? jest.fn().mockResolvedValue('CLOSED'),
    };
    const service = new PlanPurchaseService(
      prisma as never,
      {} as never,
      payos as never,
    );
    return { service, prisma, tx, payos };
  };

  const statusWrites = (tx: ReturnType<typeof setup>['tx']) => ({
    payment: tx.planPayment.update.mock.calls.map((c) => c[0].data.status),
    purchase: tx.planPurchase.update.mock.calls.map((c) => c[0].data.status),
  });

  it('selects only unpaid purchases ten minutes past their window, outside any auto-match window', async () => {
    const { service, prisma } = setup({});

    await service.expireStalePurchases(now);

    expect(prisma.planPurchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: PlanPurchaseStatus.PENDING_PAYMENT,
          payment: {
            status: PlanPaymentStatus.PENDING,
            paymentIntentExpiresAt: {
              lt: new Date('2026-11-05T04:50:00.000Z'),
            },
            OR: [{ autoMatchUntil: null }, { autoMatchUntil: { lt: now } }],
          },
        },
      }),
    );
  });

  it('expires a PayOS purchase only after PayOS says the link took no payment', async () => {
    const { service, tx, payos } = setup({});

    const result = await service.expireStalePurchases(now);

    expect(payos.closeUnpaid).toHaveBeenCalledWith(1762318800031);
    expect(result).toEqual({
      expired: 1,
      paid: 0,
      review: 0,
      open: 0,
      failed: 0,
    });
    expect(statusWrites(tx)).toEqual({
      payment: [PlanPaymentStatus.EXPIRED],
      purchase: [PlanPurchaseStatus.EXPIRED],
    });
  });

  it('leaves a purchase PayOS reports paid to the confirmation it already ran', async () => {
    const { service, tx } = setup({
      closeUnpaid: jest.fn().mockResolvedValue('PAID'),
    });

    const result = await service.expireStalePurchases(now);

    expect(result.paid).toBe(1);
    expect(tx.planPayment.update).not.toHaveBeenCalled();
    expect(tx.planPurchase.update).not.toHaveBeenCalled();
  });

  it('does not touch a purchase whose link is still open or being processed', async () => {
    const { service, tx } = setup({
      closeUnpaid: jest.fn().mockResolvedValue('OPEN'),
    });

    const result = await service.expireStalePurchases(now);

    expect(result.open).toBe(1);
    expect(tx.planPayment.update).not.toHaveBeenCalled();
  });

  it('sends a part-paid order to admin review and closes the purchase', async () => {
    const { service, tx } = setup({
      closeUnpaid: jest.fn().mockResolvedValue('REVIEW'),
    });

    const result = await service.expireStalePurchases(now);

    expect(result.review).toBe(1);
    expect(statusWrites(tx)).toEqual({
      payment: [PlanPaymentStatus.REVIEW_REQUIRED],
      purchase: [PlanPurchaseStatus.EXPIRED],
    });
  });

  it('sends a paid order whose confirmation was refused to admin review', async () => {
    const { service, tx } = setup({
      closeUnpaid: jest
        .fn()
        .mockRejectedValue(
          new ConflictException(
            'An effective or scheduled paid Subscription already exists',
          ),
        ),
    });

    const result = await service.expireStalePurchases(now);

    expect(result.review).toBe(1);
    expect(statusWrites(tx).payment).toEqual([
      PlanPaymentStatus.REVIEW_REQUIRED,
    ]);
  });

  it('changes nothing when PayOS cannot be reached, so the next run retries', async () => {
    const { service, tx } = setup({
      closeUnpaid: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    });

    const result = await service.expireStalePurchases(now);

    expect(result.failed).toBe(1);
    expect(tx.planPayment.update).not.toHaveBeenCalled();
    expect(tx.planPurchase.update).not.toHaveBeenCalled();
  });

  it('never expires a PayOS order while PayOS is not configured', async () => {
    const { service, tx, payos } = setup({ payosEnabled: false });

    const result = await service.expireStalePurchases(now);

    expect(result.open).toBe(1);
    expect(payos.closeUnpaid).not.toHaveBeenCalled();
    expect(tx.planPayment.update).not.toHaveBeenCalled();
  });

  it('expires a purchase that never got a PayOS order without asking PayOS', async () => {
    const { service, tx, payos } = setup({ orderCode: null });

    const result = await service.expireStalePurchases(now);

    expect(result.expired).toBe(1);
    expect(payos.closeUnpaid).not.toHaveBeenCalled();
    expect(statusWrites(tx).purchase).toEqual([PlanPurchaseStatus.EXPIRED]);
  });

  it('skips a purchase that was paid between the query and the lock', async () => {
    const { service, tx } = setup({
      current: stored(
        PlanPurchaseStatus.COMPLETED,
        PlanPaymentStatus.CONFIRMED,
      ),
    });

    const result = await service.expireStalePurchases(now);

    expect(result.expired).toBe(0);
    expect(tx.planPayment.update).not.toHaveBeenCalled();
  });
});

describe('PlanPurchaseService.holdPaidPurchaseForReview', () => {
  const run = async (
    status: PlanPurchaseStatus,
    payment: PlanPaymentStatus,
  ) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      planPurchase: {
        findUnique: jest.fn().mockResolvedValue({ userId: 7 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 31,
          status,
          payment: { id: 21, status: payment },
        }),
        update: jest.fn(),
      },
      planPayment: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new PlanPurchaseService(prisma as never, {} as never);
    return { held: await service.holdPaidPurchaseForReview(31), tx };
  };

  it('holds a payment that arrived after its purchase expired', async () => {
    const { held, tx } = await run(
      PlanPurchaseStatus.EXPIRED,
      PlanPaymentStatus.EXPIRED,
    );

    expect(held).toBe(true);
    expect(tx.planPayment.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: { status: PlanPaymentStatus.REVIEW_REQUIRED },
    });
    expect(tx.planPurchase.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: { status: PlanPurchaseStatus.EXPIRED },
    });
  });

  it.each([
    [PlanPurchaseStatus.COMPLETED, PlanPaymentStatus.CONFIRMED],
    [PlanPurchaseStatus.REJECTED, PlanPaymentStatus.REJECTED],
    [PlanPurchaseStatus.SUPERSEDED, PlanPaymentStatus.SUPERSEDED],
    [PlanPurchaseStatus.EXPIRED, PlanPaymentStatus.REVIEW_REQUIRED],
  ])('leaves a %s purchase with a %s payment as it is', async (s, p) => {
    const { held, tx } = await run(s, p);

    expect(held).toBe(false);
    expect(tx.planPayment.update).not.toHaveBeenCalled();
  });
});

describe('StalePurchaseScheduler', () => {
  afterEach(() => {
    delete process.env.STALE_PURCHASE_SWEEP_ENABLED;
  });

  it('runs one sweep at a time', async () => {
    let release!: () => void;
    const purchases = {
      expireStalePurchases: jest.fn(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({ expired: 0, paid: 0, review: 0, open: 0, failed: 0 });
          }),
      ),
    };
    const scheduler = new StalePurchaseScheduler(purchases as never);

    const first = scheduler.sweep();
    await scheduler.sweep();
    release();
    await first;

    expect(purchases.expireStalePurchases).toHaveBeenCalledTimes(1);
  });

  it('can be switched off', async () => {
    process.env.STALE_PURCHASE_SWEEP_ENABLED = 'false';
    const purchases = { expireStalePurchases: jest.fn() };

    await new StalePurchaseScheduler(purchases as never).sweep();

    expect(purchases.expireStalePurchases).not.toHaveBeenCalled();
  });
});
