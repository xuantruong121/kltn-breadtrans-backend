import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { SepayTransactionProvider } from './sepay-transaction.provider';

@Injectable()
export class PaymentReconciliationScheduler {
  private readonly logger = new Logger(PaymentReconciliationScheduler.name);

  constructor(
    private readonly provider: SepayTransactionProvider,
    private readonly reconciliation: PaymentReconciliationService,
  ) {}

  @Cron('*/5 * * * *')
  async reconcileRecentTransactions(): Promise<void> {
    if (
      process.env.SEPAY_RECONCILIATION_ENABLED !== 'true' ||
      !process.env.SEPAY_API_TOKEN?.trim()
    ) {
      return;
    }
    try {
      const transactions = await this.provider.fetchRecentTransactions();
      for (const transaction of transactions) {
        await this.reconciliation.ingest(transaction);
      }
    } catch (error) {
      this.logger.warn(
        `SePay reconciliation poll failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
