import {
  PayOSPaymentIntentStatus,
  PayOSPaymentIntentType,
} from '@prisma/client';
import { PayosPaymentService } from './payos-payment.service';

describe('PayosPaymentService', () => {
  const makeIntent = (status: PayOSPaymentIntentStatus) => ({
    id: 11,
    userId: 7,
    type: PayOSPaymentIntentType.PLAN,
    orderCode: BigInt(900000000011),
    paymentLinkId: 'old-link',
    checkoutUrl: 'https://payos.test/checkout',
    qrCode: 'qr',
    bankBin: '970415',
    bankAccountNumber: '123456789',
    bankAccountName: 'BREADTRANS',
    amountVnd: 99000,
    currency: 'VND',
    description: 'BreadTrans Plus',
    status,
    providerStatus: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    paidAt: null,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    planPayment: { id: 21, planPurchaseId: 31, amountVnd: 99000 },
    coursePayment: null,
  });

  it('does not mark a verified webhook paid before entitlement fulfillment', async () => {
    // No link stored yet: the verified webhook's link id is recorded.
    const intent = {
      ...makeIntent(PayOSPaymentIntentStatus.PENDING),
      paymentLinkId: null,
    };
    const prisma = {
      payOSPaymentIntent: {
        findUnique: jest.fn().mockResolvedValue(intent),
        update: jest.fn().mockResolvedValue(intent),
      },
    };
    const provider = {
      verifyWebhook: jest.fn().mockResolvedValue({
        orderCode: Number(intent.orderCode),
        amount: 99000,
        currency: 'VND',
        code: '00',
        paymentLinkId: 'new-link',
      }),
    };
    const service = new PayosPaymentService(
      prisma as never,
      provider as never,
      {} as never,
    );

    const verified = await service.resolveWebhook({});

    expect(verified?.status).toBe(PayOSPaymentIntentStatus.PENDING);
    expect(prisma.payOSPaymentIntent.update).toHaveBeenCalledWith({
      where: { id: intent.id },
      data: {
        paymentLinkId: 'new-link',
        lastSyncedAt: expect.any(Date),
      },
    });
    expect(prisma.payOSPaymentIntent.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PayOSPaymentIntentStatus.PAID,
        }),
      }),
    );
  });

  it('refuses a verified webhook whose payment link differs from the stored one', async () => {
    const intent = makeIntent(PayOSPaymentIntentStatus.PENDING);
    const prisma = {
      payOSPaymentIntent: {
        findUnique: jest.fn().mockResolvedValue(intent),
        update: jest.fn(),
      },
    };
    const provider = {
      verifyWebhook: jest.fn().mockResolvedValue({
        orderCode: Number(intent.orderCode),
        amount: 99000,
        currency: 'VND',
        code: '00',
        paymentLinkId: 'other-link',
      }),
    };
    const service = new PayosPaymentService(
      prisma as never,
      provider as never,
      {} as never,
    );
    await expect(service.resolveWebhook({})).rejects.toThrow('link mismatch');
    expect(prisma.payOSPaymentIntent.update).not.toHaveBeenCalled();
  });

  it('creates a provider order with a merchant-global time-based code', async () => {
    const intent = makeIntent(PayOSPaymentIntentStatus.PENDING);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const expectedOrderCode =
      Math.floor(Date.now() / 1000) * 1000 + (17 % 1000);
    const createdIntent = {
      ...intent,
      orderCode: BigInt(expectedOrderCode),
    };
    const prisma = {
      planPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 21,
          amountVnd: 99000,
          planPurchase: { userId: 7 },
        }),
      },
      payOSPaymentIntent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdIntent),
        update: jest.fn().mockResolvedValue({
          ...intent,
          status: PayOSPaymentIntentStatus.PENDING,
          paymentLinkId: 'provider-link',
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: BigInt(17) }]),
    };
    const provider = {
      isConfigured: jest.fn().mockReturnValue(true),
      createPayment: jest.fn().mockResolvedValue({
        orderCode: 900000000017,
        paymentLinkId: 'provider-link',
        checkoutUrl: 'https://payos.test/checkout',
        qrCode: 'qr',
        bankBin: '970415',
        bankAccountNumber: '123456789',
        bankAccountName: 'BREADTRANS',
        status: 'PENDING',
        expiresAt: intent.expiresAt,
      }),
    };
    const service = new PayosPaymentService(
      prisma as never,
      provider as never,
      {} as never,
    );

    const result = await service.createForPlanPayment(7, 21, 'Plus monthly');

    expect(prisma.payOSPaymentIntent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 7,
          planPaymentId: 21,
          amountVnd: 99000,
          orderCode: BigInt(expectedOrderCode),
        }),
      }),
    );
    expect(provider.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderCode: expectedOrderCode,
        amount: 99000,
      }),
    );
    expect(result.checkoutUrl).toBe('https://payos.test/checkout');
    jest.restoreAllMocks();
  });

  it('returns PayOS users to the existing account plan route', () => {
    const service = new PayosPaymentService(
      {} as never,
      {} as never,
      {} as never,
    );
    const intent = makeIntent(PayOSPaymentIntentStatus.PENDING);
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'http://localhost:3000/';

    expect((service as any).returnUrl(intent)).toBe(
      'http://localhost:3000/hub?tab=account-plan&intent=11',
    );
    expect((service as any).cancelUrl(intent)).toBe(
      'http://localhost:3000/hub?tab=account-plan&intent=11&cancelled=1',
    );

    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('marks a webhook paid only after canonical fulfillment returns', async () => {
    const intent = makeIntent(PayOSPaymentIntentStatus.PENDING);
    const prisma = {
      payOSPaymentIntent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new PayosPaymentService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await service.markWebhookFulfilled(intent.id);

    expect(prisma.payOSPaymentIntent.updateMany).toHaveBeenCalledWith({
      where: {
        id: intent.id,
        status: { not: PayOSPaymentIntentStatus.PAID },
      },
      data: {
        status: PayOSPaymentIntentStatus.PAID,
        providerStatus: '00',
        paidAt: expect.any(Date),
        lastSyncedAt: expect.any(Date),
      },
    });
  });

  it('does not downgrade a paid intent when polling sees a stale terminal status', async () => {
    const intent = makeIntent(PayOSPaymentIntentStatus.PAID);
    const prisma = {
      payOSPaymentIntent: {
        findUnique: jest.fn().mockResolvedValue(intent),
        update: jest.fn().mockResolvedValue(intent),
      },
    };
    const provider = {
      getPayment: jest.fn().mockResolvedValue({ status: 'CANCELLED' }),
    };
    const service = new PayosPaymentService(
      prisma as never,
      provider as never,
      {} as never,
    );
    const fulfill = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    (service as unknown as { fulfill: typeof fulfill }).fulfill = fulfill;

    await service.synchronize(Number(intent.orderCode));

    expect(fulfill).not.toHaveBeenCalled();
    expect(prisma.payOSPaymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PayOSPaymentIntentStatus.PAID,
          providerStatus: 'CANCELLED',
        }),
      }),
    );
  });
});
