import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PlanPaymentStatus, PlanPurchaseStatus } from '@prisma/client';
import { PlanPurchaseService } from './plan-purchase.service';

/**
 * A new QR for a purchase closes the old PayOS link first (audit R2,
 * 2026-11-18): otherwise a learner who scanned the old QR could pay it after
 * the purchase was marked SUPERSEDED, and the webhook found nowhere to put
 * the money.
 */
describe('PlanPurchaseService.replacePayment with PayOS', () => {
  const setup = (outcome: 'PAID' | 'REVIEW' | 'OPEN' | 'CLOSED' | Error) => {
    const order: string[] = [];
    const prisma = {
      planPurchase: {
        findFirst: jest.fn().mockResolvedValue({
          status: PlanPurchaseStatus.PENDING_PAYMENT,
          supersededByPurchaseId: null,
          payment: {
            status: PlanPaymentStatus.PENDING,
            payosIntent: { orderCode: BigInt(1763450000123) },
          },
        }),
      },
      $transaction: jest.fn(() => {
        order.push('transaction');
        return Promise.reject(new Error('reached the transaction'));
      }),
    };
    const payos = {
      isEnabled: () => true,
      closeUnpaid: jest.fn(() => {
        order.push('closeUnpaid');
        return outcome instanceof Error
          ? Promise.reject(outcome)
          : Promise.resolve(outcome);
      }),
    };
    const service = new PlanPurchaseService(
      prisma as never,
      {} as never,
      payos as never,
    );
    const getMyPurchase = jest
      .spyOn(service, 'getMyPurchase')
      .mockResolvedValue({ id: 31 } as never);
    const hold = jest
      .spyOn(service, 'holdPaidPurchaseForReview')
      .mockResolvedValue(true);
    return { service, prisma, payos, order, getMyPurchase, hold };
  };

  it('a closed old link: the replacement goes ahead, after the close', async () => {
    const { service, payos, order } = setup('CLOSED');
    await expect(service.replacePayment(7, 31)).rejects.toThrow(
      'reached the transaction',
    );
    expect(payos.closeUnpaid).toHaveBeenCalledWith(1763450000123);
    expect(order).toEqual(['closeUnpaid', 'transaction']);
  });

  it('an old link still open or in progress: 409, nothing replaced', async () => {
    const { service, prisma } = setup('OPEN');
    await expect(service.replacePayment(7, 31)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('an old link paid a moment ago: that purchase comes back, nothing replaced', async () => {
    const { service, prisma, getMyPurchase } = setup('PAID');
    await expect(service.replacePayment(7, 31)).resolves.toEqual({ id: 31 });
    expect(getMyPurchase).toHaveBeenCalledWith(7, 31);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('an old link part paid: held for an admin, 409', async () => {
    const { service, prisma, hold } = setup('REVIEW');
    await expect(service.replacePayment(7, 31)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(hold).toHaveBeenCalledWith(31);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PayOS unreachable: 503, nothing replaced', async () => {
    const { service, prisma } = setup(new Error('ETIMEDOUT'));
    await expect(service.replacePayment(7, 31)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
