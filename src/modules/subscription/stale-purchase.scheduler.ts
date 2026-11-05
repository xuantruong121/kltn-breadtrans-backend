import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PlanPurchaseService } from './plan-purchase.service';

/**
 * Every five minutes, closes purchases whose payment window passed without
 * payment (PlanPurchaseService.expireStalePurchases). Before this, an unpaid
 * purchase stayed "Chờ thanh toán" until the learner bought again.
 */
@Injectable()
export class StalePurchaseScheduler {
  private readonly logger = new Logger(StalePurchaseScheduler.name);
  private running = false;

  constructor(private readonly purchases: PlanPurchaseService) {}

  @Cron('*/5 * * * *')
  async sweep(): Promise<void> {
    if (process.env.STALE_PURCHASE_SWEEP_ENABLED === 'false') return;
    // A slow PayOS round must not overlap the next tick.
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.purchases.expireStalePurchases();
      if (result.expired + result.paid + result.review + result.failed > 0) {
        this.logger.log(
          `stale_purchase_sweep expired=${result.expired} paid=${result.paid} review=${result.review} open=${result.open} failed=${result.failed}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `stale_purchase_sweep_unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
