import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BUSINESS_TIMEZONE } from '../../common/time/business-time.util';
import { OFF_MIDNIGHT_CRON } from '../../common/time/off-midnight-cron';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { SepayTransactionProvider } from './sepay-transaction.provider';

@Injectable()
export class PaymentReconciliationScheduler {
  private readonly logger = new Logger(PaymentReconciliationScheduler.name);

  constructor(
    private readonly provider: SepayTransactionProvider,
    private readonly reconciliation: PaymentReconciliationService,
  ) {}

  // Every five minutes, never at 00:00 (OFF_MIDNIGHT_CRON): hour 0 runs at
  // 00:02, then 00:05 onwards.
  @Cron(OFF_MIDNIGHT_CRON.everyFiveMinutes, { timeZone: BUSINESS_TIMEZONE })
  async reconcileRecentTransactions(): Promise<void> {
    await this.reconcile();
  }

  @Cron(OFF_MIDNIGHT_CRON.everyFiveMinutesAfterMidnight, {
    timeZone: BUSINESS_TIMEZONE,
  })
  async reconcileRecentTransactionsAfterMidnight(): Promise<void> {
    await this.reconcile();
  }

  private async reconcile(): Promise<void> {
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
