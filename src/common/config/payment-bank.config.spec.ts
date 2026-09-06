import { getPaymentBankConfig } from './payment-bank.config';

describe('getPaymentBankConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PAYMENT_BANK_BIN;
    delete process.env.PAYMENT_BANK_NAME;
    delete process.env.PAYMENT_BANK_ACCOUNT_NUMBER;
    delete process.env.PAYMENT_BANK_ACCOUNT_NAME;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails clearly when requested configuration is missing', () => {
    expect(() => getPaymentBankConfig()).toThrow(
      '[Payment Config] Missing required environment variable(s)',
    );
  });

  it('rejects an invalid bank BIN', () => {
    process.env.PAYMENT_BANK_BIN = 'ABC';
    process.env.PAYMENT_BANK_NAME = 'Example Bank';
    process.env.PAYMENT_BANK_ACCOUNT_NUMBER = '0000000000';
    process.env.PAYMENT_BANK_ACCOUNT_NAME = 'BREADTRANS CENTER';
    expect(() => getPaymentBankConfig()).toThrow(
      'PAYMENT_BANK_BIN must contain 6 digits',
    );
  });

  it('returns normalized single-center bank configuration', () => {
    process.env.PAYMENT_BANK_BIN = ' 970436 ';
    process.env.PAYMENT_BANK_NAME = ' Example Bank ';
    process.env.PAYMENT_BANK_ACCOUNT_NUMBER = ' 0000000000 ';
    process.env.PAYMENT_BANK_ACCOUNT_NAME = ' BREADTRANS CENTER ';
    expect(getPaymentBankConfig()).toEqual({
      bin: '970436',
      bankName: 'Example Bank',
      accountNumber: '0000000000',
      accountName: 'BREADTRANS CENTER',
    });
  });
});
