import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PayOS,
  type CreatePaymentLinkResponse,
  type Webhook,
  type WebhookData,
} from '@payos/node';

export type PayosCreatePaymentInput = {
  orderCode: number;
  amount: number;
  description: string;
  itemName: string;
  returnUrl: string;
  cancelUrl: string;
  expiredAt?: number;
};

export type PayosPaymentResult = {
  orderCode: number;
  paymentLinkId: string;
  checkoutUrl: string;
  qrCode: string;
  bankBin: string;
  bankAccountNumber: string;
  bankAccountName: string;
  status: string;
  expiresAt: Date | null;
};

/** The only application boundary allowed to call the PayOS merchant API. */
@Injectable()
export class PayosProvider {
  private readonly logger = new Logger(PayosProvider.name);
  private client: PayOS | null = null;

  isConfigured(): boolean {
    return Boolean(
      process.env.PAYOS_CLIENT_ID?.trim() &&
      process.env.PAYOS_API_KEY?.trim() &&
      process.env.PAYOS_CHECKSUM_KEY?.trim(),
    );
  }

  private getClient(): PayOS {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'PayOS chưa được cấu hình đầy đủ trên máy chủ',
      );
    }
    if (!this.client) {
      this.client = new PayOS({
        clientId: process.env.PAYOS_CLIENT_ID,
        apiKey: process.env.PAYOS_API_KEY,
        checksumKey: process.env.PAYOS_CHECKSUM_KEY,
        logLevel: 'error',
      });
    }
    return this.client;
  }

  async createPayment(
    input: PayosCreatePaymentInput,
  ): Promise<PayosPaymentResult> {
    let result: CreatePaymentLinkResponse;
    try {
      result = await this.getClient().paymentRequests.create({
        orderCode: input.orderCode,
        amount: input.amount,
        description: input.description,
        items: [{ name: input.itemName, quantity: 1, price: input.amount }],
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        ...(input.expiredAt ? { expiredAt: input.expiredAt } : {}),
      });
    } catch (error) {
      const providerError = error as {
        constructor?: { name?: string };
        status?: number;
        code?: string | number;
      };
      this.logger.error(
        `PayOS payment-link creation failed class=${providerError.constructor?.name ?? 'Unknown'} status=${providerError.status ?? 'unknown'} code=${providerError.code ?? 'unknown'}`,
      );
      throw new ServiceUnavailableException(
        'Cổng thanh toán PayOS hiện chưa thể tạo liên kết. Vui lòng thử lại sau.',
      );
    }
    return {
      orderCode: result.orderCode,
      paymentLinkId: result.paymentLinkId,
      checkoutUrl: result.checkoutUrl,
      qrCode: result.qrCode,
      bankBin: result.bin,
      bankAccountNumber: result.accountNumber,
      bankAccountName: result.accountName,
      status: result.status,
      expiresAt: result.expiredAt ? new Date(result.expiredAt * 1000) : null,
    };
  }

  getPayment(orderCode: number) {
    return this.getClient().paymentRequests.get(orderCode);
  }

  cancelPayment(orderCode: number, reason: string) {
    return this.getClient().paymentRequests.cancel(orderCode, reason);
  }

  verifyWebhook(payload: unknown): Promise<WebhookData> {
    return this.getClient().webhooks.verify(payload as Webhook);
  }
}
