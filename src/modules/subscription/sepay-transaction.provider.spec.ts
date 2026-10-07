import { SepayTransactionProvider } from './sepay-transaction.provider';

describe('SepayTransactionProvider', () => {
  it('normalizes the documented webhook payload without retaining secrets', () => {
    const result = new SepayTransactionProvider().parseWebhookPayload({
      id: 92704,
      gateway: 'Vietcombank',
      transactionDate: '2024-07-02 11:08:33',
      accountNumber: '1352359401',
      code: 'SEVN63DC8E5C',
      content: 'BTP00000031 chuyen tien',
      transferType: 'in',
      transferAmount: 69000,
      referenceCode: 'FT24012345678',
    });

    expect(result).toMatchObject({
      provider: 'SEPAY',
      externalTransactionId: '92704',
      transferType: 'in',
      amount: 69000,
      paymentCode: 'SEVN63DC8E5C',
      rawContent: 'BTP00000031 chuyen tien',
    });
    expect(result.occurredAt).toBeInstanceOf(Date);
  });
});
