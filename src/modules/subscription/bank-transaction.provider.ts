export type NormalizedBankTransaction = {
  provider: string;
  externalTransactionId: string;
  bankReference: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  gateway: string | null;
  transferType: string;
  amount: number;
  currency: string;
  paymentCode: string | null;
  rawContent: string | null;
  occurredAt: Date;
};

export interface BankTransactionProvider {
  readonly provider: string;
  parseWebhookPayload(payload: unknown): NormalizedBankTransaction;
  fetchRecentTransactions(): Promise<NormalizedBankTransaction[]>;
}
