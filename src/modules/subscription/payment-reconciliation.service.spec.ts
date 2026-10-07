import { BankTransactionMatchStatus, PlanPaymentStatus } from '@prisma/client';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { SepayTransactionProvider } from './sepay-transaction.provider';

describe('PaymentReconciliationService', () => {
  const occurredAt = new Date('2026-10-07T08:00:00.000Z');
  const incoming = {
    provider: 'SEPAY',
    externalTransactionId: '92704',
    bankReference: 'FT-1',
    bankAccount: '1352359401',
    bankCode: 'SEVN',
    gateway: 'Vietcombank',
    transferType: 'in',
    amount: 69000,
    currency: 'VND',
    paymentCode: null,
    rawContent: 'BTP00000031 chuyen tien',
    occurredAt,
  };

  function makeHarness(options?: {
    existingStatus?: BankTransactionMatchStatus;
    payment?: Record<string, unknown>;
    confirm?: jest.Mock;
  }) {
    const record = {
      id: 11,
      provider: 'SEPAY',
      externalTransactionId: '92704',
      matchStatus:
        options?.existingStatus ?? BankTransactionMatchStatus.RECEIVED,
    };
    const tx = {
      bankTransaction: {
        findUnique: jest
          .fn()
          .mockResolvedValue(options?.existingStatus ? record : null),
        create: jest.fn().mockResolvedValue(record),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...record, ...data }),
          ),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...record,
          matchStatus: BankTransactionMatchStatus.MATCHED,
        }),
      },
      planPayment: {
        findMany: jest.fn().mockResolvedValue([
          options?.payment ?? {
            id: 21,
            planPurchaseId: 31,
            amountVnd: 69000,
            currency: 'VND',
            transferCode: 'BTP00000031',
            status: PlanPaymentStatus.PENDING,
            bankAccountNumber: '1352359401',
            bankName: 'Vietcombank',
            autoMatchUntil: new Date('2026-10-09T08:00:00.000Z'),
            planPurchase: {
              id: 31,
              createdAt: new Date('2026-10-07T07:00:00.000Z'),
              status: 'PENDING_PAYMENT',
            },
          },
        ]),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const confirm = options?.confirm ?? jest.fn().mockResolvedValue(undefined);
    const service = new PaymentReconciliationService(
      prisma as never,
      { confirmPurchaseFromWebhook: confirm } as never,
      new SepayTransactionProvider(),
    );
    return { service, tx, confirm };
  }

  it('auto-confirms an exact incoming transaction once', async () => {
    const { service, confirm, tx } = makeHarness();

    const result = await service.ingest(incoming);

    expect(confirm).toHaveBeenCalledWith(31, 11, tx);
    expect(result.matchStatus).toBe(BankTransactionMatchStatus.MATCHED);
    expect(result.duplicate).toBe(false);
  });

  it('prioritizes an exact provider payment code', async () => {
    const { service, confirm, tx } = makeHarness();

    const result = await service.ingest({
      ...incoming,
      paymentCode: 'BTP00000031',
      rawContent: 'noi dung khac',
    });

    expect(confirm).toHaveBeenCalledWith(31, 11, tx);
    expect(result.matchStatus).toBe(BankTransactionMatchStatus.MATCHED);
  });

  it('routes an exact-code amount mismatch to review without activation', async () => {
    const { service, confirm, tx } = makeHarness({
      payment: {
        id: 21,
        planPurchaseId: 31,
        amountVnd: 99000,
        currency: 'VND',
        transferCode: 'BTP00000031',
        status: PlanPaymentStatus.PENDING,
        bankAccountNumber: '1352359401',
        bankName: 'Vietcombank',
        autoMatchUntil: new Date('2026-10-09T08:00:00.000Z'),
        planPurchase: {
          id: 31,
          createdAt: new Date('2026-10-07T07:00:00.000Z'),
          status: 'PENDING_PAYMENT',
        },
      },
    });

    const result = await service.ingest(incoming);

    expect(result.matchStatus).toBe(BankTransactionMatchStatus.REVIEW_REQUIRED);
    expect(confirm).not.toHaveBeenCalled();
    expect(tx.bankTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { matchStatus: BankTransactionMatchStatus.REVIEW_REQUIRED },
      }),
    );
  });

  it('keeps the late-bank grace after the UI intent expiry', async () => {
    const { service, confirm } = makeHarness({
      payment: {
        id: 21,
        planPurchaseId: 31,
        amountVnd: 69000,
        currency: 'VND',
        transferCode: 'BTP00000031',
        status: PlanPaymentStatus.PENDING,
        bankAccountNumber: '1352359401',
        bankName: 'Vietcombank',
        paymentIntentExpiresAt: new Date('2026-10-07T07:15:00.000Z'),
        autoMatchUntil: new Date('2026-10-08T08:00:00.000Z'),
        planPurchase: {
          id: 31,
          createdAt: new Date('2026-10-07T07:00:00.000Z'),
          status: 'PENDING_PAYMENT',
        },
      },
    });

    const result = await service.ingest(incoming);

    expect(confirm).toHaveBeenCalledWith(31, 11, expect.anything());
    expect(result.matchStatus).toBe(BankTransactionMatchStatus.MATCHED);
  });

  it('routes a superseded payment code to review without activation', async () => {
    const { service, confirm } = makeHarness({
      payment: {
        id: 21,
        planPurchaseId: 31,
        amountVnd: 69000,
        currency: 'VND',
        transferCode: 'BTP00000031',
        status: PlanPaymentStatus.SUPERSEDED,
        bankAccountNumber: '1352359401',
        bankName: 'Vietcombank',
        autoMatchUntil: new Date('2026-10-08T08:00:00.000Z'),
        planPurchase: {
          id: 31,
          createdAt: new Date('2026-10-07T07:00:00.000Z'),
          status: 'SUPERSEDED',
        },
      },
    });

    const result = await service.ingest(incoming);

    expect(confirm).not.toHaveBeenCalled();
    expect(result.matchStatus).toBe(BankTransactionMatchStatus.REVIEW_REQUIRED);
    expect(result.planPurchaseId).toBe(31);
  });

  it('ignores outgoing transactions', async () => {
    const { service, confirm } = makeHarness();

    const result = await service.ingest({ ...incoming, transferType: 'out' });

    expect(result.matchStatus).toBe(BankTransactionMatchStatus.IGNORED);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('returns a duplicate success result without a second activation', async () => {
    const { service, confirm, tx } = makeHarness({
      existingStatus: BankTransactionMatchStatus.MATCHED,
    });

    const result = await service.ingest(incoming);

    expect(result.duplicate).toBe(true);
    expect(result.matchStatus).toBe(BankTransactionMatchStatus.MATCHED);
    expect(tx.bankTransaction.create).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('marks a second transaction with a consumed code as duplicate', async () => {
    const { service, confirm, tx } = makeHarness();
    tx.planPayment.findMany.mockResolvedValueOnce([
      {
        id: 21,
        planPurchaseId: 31,
        transferCode: 'BTP00000031',
        status: PlanPaymentStatus.CONFIRMED,
        planPurchase: { id: 31 },
      },
    ]);

    const result = await service.ingest(incoming);

    expect(result.matchStatus).toBe(BankTransactionMatchStatus.DUPLICATE);
    expect(result.planPurchaseId).toBe(31);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('requires the receiving account snapshot to match exactly', async () => {
    const { service, confirm } = makeHarness({
      payment: {
        id: 21,
        planPurchaseId: 31,
        amountVnd: 69000,
        currency: 'VND',
        transferCode: 'BTP00000031',
        status: PlanPaymentStatus.PENDING,
        bankAccountNumber: '0000000000',
        bankName: 'Vietcombank',
        autoMatchUntil: new Date('2026-10-09T08:00:00.000Z'),
        planPurchase: {
          id: 31,
          createdAt: new Date('2026-10-07T07:00:00.000Z'),
          status: 'PENDING_PAYMENT',
        },
      },
    });

    const result = await service.ingest(incoming);

    expect(result.matchStatus).toBe(BankTransactionMatchStatus.REVIEW_REQUIRED);
    expect(confirm).not.toHaveBeenCalled();
  });
});
