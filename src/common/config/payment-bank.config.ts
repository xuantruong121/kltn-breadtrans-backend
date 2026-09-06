export interface PaymentBankConfig {
  bin: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export const getPaymentBankConfig = (): PaymentBankConfig => {
  const bin = process.env.PAYMENT_BANK_BIN?.trim();
  const bankName = process.env.PAYMENT_BANK_NAME?.trim();
  const accountNumber = process.env.PAYMENT_BANK_ACCOUNT_NUMBER?.trim();
  const accountName = process.env.PAYMENT_BANK_ACCOUNT_NAME?.trim();
  const missing = [
    ['PAYMENT_BANK_BIN', bin],
    ['PAYMENT_BANK_NAME', bankName],
    ['PAYMENT_BANK_ACCOUNT_NUMBER', accountNumber],
    ['PAYMENT_BANK_ACCOUNT_NAME', accountName],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `[Payment Config] Missing required environment variable(s): ${missing.join(', ')}`,
    );
  }
  if (!/^\d{6}$/.test(bin!)) {
    throw new Error('[Payment Config] PAYMENT_BANK_BIN must contain 6 digits.');
  }
  if (!/^\d{4,32}$/.test(accountNumber!)) {
    throw new Error(
      '[Payment Config] PAYMENT_BANK_ACCOUNT_NUMBER must contain 4 to 32 digits.',
    );
  }

  return {
    bin: bin!,
    bankName: bankName!,
    accountNumber: accountNumber!,
    accountName: accountName!,
  };
};
