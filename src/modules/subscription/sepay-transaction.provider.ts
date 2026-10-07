import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BankTransactionProvider,
  NormalizedBankTransaction,
} from './bank-transaction.provider';

type SepayPayload = {
  id?: string | number;
  gateway?: string;
  transactionDate?: string;
  accountNumber?: string;
  code?: string | null;
  content?: string | null;
  description?: string | null;
  transferType?: string;
  transferAmount?: string | number;
  amountIn?: string | number;
  amountOut?: string | number;
  amount_in?: string | number;
  amount_out?: string | number;
  referenceCode?: string | null;
  reference_number?: string | null;
  bank_brand_name?: string;
  transaction_date?: string;
  account_number?: string;
  transaction_content?: string | null;
  bank_account_id?: string | number;
};

@Injectable()
export class SepayTransactionProvider implements BankTransactionProvider {
  readonly provider = 'SEPAY';

  parseWebhookPayload(payload: unknown): NormalizedBankTransaction {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Invalid SePay webhook payload');
    }
    return this.normalize(payload);
  }

  async fetchRecentTransactions(): Promise<NormalizedBankTransaction[]> {
    const token = process.env.SEPAY_API_TOKEN?.trim();
    if (!token) return [];

    const url = new URL(
      process.env.SEPAY_TRANSACTIONS_URL?.trim() ||
        'https://my.sepay.vn/userapi/transactions/list',
    );
    url.searchParams.set(
      'limit',
      process.env.SEPAY_RECONCILIATION_LIMIT || '100',
    );
    const accountNumber = process.env.PAYMENT_BANK_ACCOUNT_NUMBER?.trim();
    if (accountNumber) url.searchParams.set('account_number', accountNumber);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(
        `SePay transaction query failed with status ${response.status}`,
      );
    }
    const body = (await response.json()) as { transactions?: unknown[] };
    return (body.transactions ?? [])
      .filter((item): item is object =>
        Boolean(item && typeof item === 'object'),
      )
      .map((item) => this.normalize(item as SepayPayload));
  }

  private normalize(payload: SepayPayload): NormalizedBankTransaction {
    const id = payload.id;
    const externalTransactionId =
      id === undefined || id === null ? '' : String(id).trim();
    const occurredAt = this.parseDate(
      payload.transactionDate || payload.transaction_date,
    );
    const transferType =
      String(payload.transferType || '')
        .trim()
        .toLowerCase() ||
      (this.number(payload.amountIn ?? payload.amount_in) > 0 ? 'in' : 'out');
    const transferAmount = this.number(
      payload.transferAmount ??
        (transferType === 'in'
          ? (payload.amountIn ?? payload.amount_in)
          : (payload.amountOut ?? payload.amount_out)),
    );
    const content = String(
      payload.content ??
        payload.transaction_content ??
        payload.description ??
        '',
    ).trim();
    if (
      !externalTransactionId ||
      !occurredAt ||
      !Number.isSafeInteger(transferAmount)
    ) {
      throw new BadRequestException('Invalid SePay transaction fields');
    }
    return {
      provider: this.provider,
      externalTransactionId,
      bankReference: this.stringOrNull(
        payload.referenceCode ?? payload.reference_number,
      ),
      bankAccount: this.stringOrNull(
        payload.accountNumber ?? payload.account_number,
      ),
      bankCode: this.stringOrNull(payload.code),
      gateway: this.stringOrNull(payload.gateway ?? payload.bank_brand_name),
      transferType,
      amount: transferAmount,
      currency: 'VND',
      paymentCode: this.stringOrNull(payload.code),
      rawContent: content || null,
      occurredAt,
    };
  }

  private number(value: string | number | undefined | null): number {
    const parsed = typeof value === 'number' ? value : Number(value ?? NaN);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : NaN;
  }

  private stringOrNull(
    value: string | number | null | undefined,
  ): string | null {
    const result =
      value === undefined || value === null ? '' : String(value).trim();
    return result || null;
  }

  private parseDate(value: string | undefined): Date | null {
    if (!value) return null;
    const normalized = value.trim().includes('T')
      ? value.trim()
      : `${value.trim().replace(' ', 'T')}+07:00`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
