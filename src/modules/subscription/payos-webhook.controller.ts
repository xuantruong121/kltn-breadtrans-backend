import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { SkipResponseTransform } from '../../common/decorators/skip-response-transform.decorator';
import { PayosPaymentService } from '../payment/payos-payment.service';
import { PlanPurchaseService } from './plan-purchase.service';

// The app does not use a global `api` prefix. Keep the externally configured
// PayOS callback path stable without changing every existing API route.
@Controller('api/payments/payos')
export class PayosWebhookController {
  constructor(
    private readonly payos: PayosPaymentService,
    private readonly plans: PlanPurchaseService,
  ) {}

  // PayOS uses a GET probe when an endpoint is saved in the merchant portal.
  // It must never mutate payment state; the signed POST below remains the only
  // route that processes a payment notification.
  @Get('webhook')
  @HttpCode(HttpStatus.OK)
  @SkipResponseTransform()
  health(): { success: true } {
    return { success: true };
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @SkipResponseTransform()
  async receive(@Body() payload: unknown): Promise<{ success: true }> {
    const intent = await this.payos.resolveWebhook(payload);
    if (!intent) return { success: true };
    // Only plan purchases are fulfilled. A retired classroom tuition intent
    // is acknowledged (so PayOS stops retrying) but grants nothing and stays
    // unfulfilled for review.
    if (intent.type !== 'PLAN' || !intent.planPayment) return { success: true };
    const purchaseId = intent.planPayment.planPurchaseId;
    try {
      await this.plans.confirmPurchaseFromWebhook(purchaseId, undefined);
    } catch (error) {
      // The money is real but cannot be applied automatically, typically a
      // payment that arrived after the purchase expired. It waits for an
      // admin instead of being refused, which would leave it nowhere.
      if (
        !(error instanceof ConflictException) ||
        !(await this.plans.holdPaidPurchaseForReview(purchaseId))
      ) {
        throw error;
      }
    }
    await this.payos.markWebhookFulfilled(intent.id);
    return { success: true };
  }
}
