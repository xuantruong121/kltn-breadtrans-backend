import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { SkipResponseTransform } from '../../common/decorators/skip-response-transform.decorator';

@Controller('payments/webhooks')
export class PaymentWebhookController {
  constructor(private readonly reconciliation: PaymentReconciliationService) {}

  @Post('sepay')
  @HttpCode(HttpStatus.OK)
  @SkipResponseTransform()
  async receiveSepay(
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ success: true }> {
    this.verifySignature(request);
    await this.reconciliation.ingestWebhook(request.body);
    return { success: true };
  }

  private verifySignature(request: RawBodyRequest<Request>): void {
    const secret = process.env.SEPAY_WEBHOOK_SECRET?.trim();
    const signature = request.header('X-SePay-Signature')?.trim() || '';
    const timestamp = request.header('X-SePay-Timestamp')?.trim() || '';
    const timestampNumber = Number(timestamp);
    const maxSkew = Number(process.env.SEPAY_WEBHOOK_MAX_SKEW_SECONDS || 300);
    const rawBody = request.rawBody;
    if (
      !secret ||
      !rawBody ||
      !/^\d+$/.test(timestamp) ||
      !Number.isSafeInteger(timestampNumber) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > maxSkew ||
      !/^sha256=[a-f0-9]{64}$/i.test(signature)
    ) {
      throw new UnauthorizedException('Invalid webhook authentication');
    }

    const expected = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex')}`;
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new UnauthorizedException('Invalid webhook authentication');
    }
  }
}
