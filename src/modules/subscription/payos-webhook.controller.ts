import {
  Body,
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
    await this.plans.confirmPurchaseFromWebhook(
      intent.planPayment.planPurchaseId,
      undefined,
    );
    await this.payos.markWebhookFulfilled(intent.id);
    return { success: true };
  }
}
