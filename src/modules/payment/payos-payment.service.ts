import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  PayOSPaymentIntentStatus,
  PayOSPaymentIntentType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayosProvider, type PayosPaymentResult } from './payos.provider';

export type PayosIntentDto = {
  intentId: number;
  type: PayOSPaymentIntentType;
  orderCode: number;
  description: string;
  paymentLinkId: string | null;
  checkoutUrl: string | null;
  qrCode: string | null;
  bankBin: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  status: PayOSPaymentIntentStatus;
  expiresAt: Date | null;
};

type IntentWithTarget = Prisma.PayOSPaymentIntentGetPayload<{
  include: { planPayment: true };
}>;

@Injectable()
export class PayosPaymentService {
  private readonly logger = new Logger(PayosPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PayosProvider,
    private readonly moduleRef: ModuleRef,
  ) {}

  isEnabled(): boolean {
    return this.provider.isConfigured();
  }

  async createForPlanPayment(
    userId: number,
    planPaymentId: number,
    itemName: string,
  ): Promise<PayosIntentDto> {
    const payment = await this.prisma.planPayment.findFirst({
      where: { id: planPaymentId, planPurchase: { userId } },
      include: { planPurchase: true },
    });
    if (!payment)
      throw new NotFoundException('Không tìm thấy khoản thanh toán.');
    const existing = await this.prisma.payOSPaymentIntent.findUnique({
      where: { planPaymentId },
      include: { planPayment: true },
    });
    if (existing?.checkoutUrl && existing.qrCode) return this.toDto(existing);
    const intent =
      existing ??
      (await this.createIntent({
        userId,
        type: PayOSPaymentIntentType.PLAN,
        planPaymentId,
        amountVnd: payment.amountVnd,
        // The plan bought ("BreadTrans Pro — 30 ngày" → "BreadTrans Pro"); it
        // used to say Plus for every plan. PayOS caps descriptions at 25.
        description: itemName.split(' — ')[0].slice(0, 25),
        // The PayOS link closes with the purchase's payment window. Without
        // it a saved QR stayed payable long after the app showed it expired.
        expiresAt: payment.paymentIntentExpiresAt,
      }));
    return this.createProviderLink(intent, itemName);
  }

  async getOwnedIntent(
    userId: number,
    intentId: number,
  ): Promise<PayosIntentDto> {
    const intent = await this.prisma.payOSPaymentIntent.findFirst({
      where: { id: intentId, userId },
      include: { planPayment: true },
    });
    if (!intent)
      throw new NotFoundException('Không tìm thấy yêu cầu thanh toán.');
    return this.toDto(intent);
  }

  async synchronize(orderCode: number): Promise<PayosIntentDto> {
    const intent = await this.findByOrderCode(orderCode);
    const remote = await this.provider.getPayment(orderCode);
    const providerStatus = remote.status;
    let mappedStatus = this.mapStatus(providerStatus);
    // "PAID" alone does not settle this order: the provider record must be
    // our payment link, for our amount, fully paid.
    if (
      mappedStatus === PayOSPaymentIntentStatus.PAID &&
      ((intent.paymentLinkId && remote.id !== intent.paymentLinkId) ||
        remote.amount !== intent.amountVnd ||
        remote.amountPaid < intent.amountVnd)
    ) {
      this.logger.warn(
        `PayOS sync refused for intent ${intent.id}: link/amount mismatch`,
      );
      mappedStatus = intent.status;
    }
    const status =
      intent.status === PayOSPaymentIntentStatus.PAID &&
      mappedStatus !== PayOSPaymentIntentStatus.PAID
        ? PayOSPaymentIntentStatus.PAID
        : mappedStatus;
    if (
      mappedStatus === PayOSPaymentIntentStatus.PAID &&
      intent.status !== PayOSPaymentIntentStatus.PAID
    ) {
      await this.fulfill({
        ...intent,
        status: PayOSPaymentIntentStatus.PAID,
        paidAt: intent.paidAt ?? new Date(),
      });
    }
    const updated = await this.prisma.payOSPaymentIntent.update({
      where: { id: intent.id },
      data: {
        status,
        providerStatus,
        lastSyncedAt: new Date(),
        paidAt:
          status === PayOSPaymentIntentStatus.PAID
            ? (intent.paidAt ?? new Date())
            : intent.paidAt,
      },
      include: { planPayment: true },
    });
    return this.toDto(updated);
  }

  /**
   * Settles an order whose payment window has passed. PayOS is asked for the
   * real state first (synchronize also confirms a paid order); a link still
   * open is cancelled before the caller may close the purchase.
   *
   * PAID: confirmed. REVIEW: part paid, for an admin. OPEN: still open or
   * being processed, try again later. CLOSED: nothing paid and the link can
   * no longer take a payment.
   */
  async closeUnpaid(
    orderCode: number,
  ): Promise<'PAID' | 'REVIEW' | 'OPEN' | 'CLOSED'> {
    const synced = await this.synchronize(orderCode);
    switch (synced.status) {
      case PayOSPaymentIntentStatus.PAID:
        return 'PAID';
      case PayOSPaymentIntentStatus.UNDERPAID:
        return 'REVIEW';
      case PayOSPaymentIntentStatus.PROCESSING:
        return 'OPEN';
      case PayOSPaymentIntentStatus.PENDING:
        try {
          await this.provider.cancelPayment(
            orderCode,
            'Hết thời hạn thanh toán',
          );
        } catch (error) {
          this.logger.warn(
            `PayOS cancel refused for order ${orderCode}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
          return 'OPEN';
        }
        await this.prisma.payOSPaymentIntent.update({
          where: { id: synced.intentId },
          data: {
            status: PayOSPaymentIntentStatus.CANCELLED,
            providerStatus: 'CANCELLED',
            lastSyncedAt: new Date(),
          },
        });
        return 'CLOSED';
      default:
        return 'CLOSED';
    }
  }

  async cancel(
    userId: number,
    intentId: number,
    reason = 'Cancelled by learner',
  ) {
    const intent = await this.prisma.payOSPaymentIntent.findFirst({
      where: { id: intentId, userId },
      include: { planPayment: true },
    });
    if (!intent)
      throw new NotFoundException('Không tìm thấy yêu cầu thanh toán.');
    if (intent.status === PayOSPaymentIntentStatus.PAID) {
      throw new ConflictException('Không thể hủy khoản đã thanh toán.');
    }
    await this.provider.cancelPayment(Number(intent.orderCode), reason);
    const updated = await this.prisma.payOSPaymentIntent.update({
      where: { id: intent.id },
      data: {
        status: PayOSPaymentIntentStatus.CANCELLED,
        providerStatus: 'CANCELLED',
      },
      include: { planPayment: true },
    });
    return this.toDto(updated);
  }

  async resolveWebhook(payload: unknown): Promise<IntentWithTarget | null> {
    const data = await this.provider.verifyWebhook(payload);
    const intent = await this.prisma.payOSPaymentIntent.findUnique({
      where: { orderCode: BigInt(data.orderCode) },
      include: { planPayment: true },
    });
    // PayOS's confirm-webhook probe uses a signed sample orderCode that is not
    // one of our orders. The signature has already been verified, so it is
    // safe to acknowledge the probe without mutating payment state.
    if (!intent) return null;
    if (intent.amountVnd !== data.amount || intent.currency !== data.currency) {
      throw new BadRequestException(
        'PayOS payment amount or currency mismatch',
      );
    }
    if (data.code !== '00') {
      throw new BadRequestException(
        'PayOS webhook is not a successful payment',
      );
    }
    // A signed notification for a different payment link of the same order
    // code is not this payment; never adopt the webhook's link id.
    if (
      intent.paymentLinkId &&
      data.paymentLinkId &&
      data.paymentLinkId !== intent.paymentLinkId
    ) {
      throw new BadRequestException('PayOS payment link mismatch');
    }
    const paymentLinkId = data.paymentLinkId || intent.paymentLinkId;
    await this.prisma.payOSPaymentIntent.update({
      where: { id: intent.id },
      data: {
        paymentLinkId,
        lastSyncedAt: new Date(),
      },
    });
    return { ...intent, paymentLinkId };
  }

  async markWebhookFulfilled(intentId: number): Promise<void> {
    await this.prisma.payOSPaymentIntent.updateMany({
      where: {
        id: intentId,
        status: { not: PayOSPaymentIntentStatus.PAID },
      },
      data: {
        status: PayOSPaymentIntentStatus.PAID,
        providerStatus: '00',
        paidAt: new Date(),
        lastSyncedAt: new Date(),
      },
    });
  }

  async findByOrderCode(orderCode: number): Promise<IntentWithTarget> {
    const intent = await this.prisma.payOSPaymentIntent.findUnique({
      where: { orderCode: BigInt(orderCode) },
      include: { planPayment: true },
    });
    if (!intent) throw new NotFoundException('PayOS orderCode is not mapped');
    return intent;
  }

  private async createIntent(data: {
    userId: number;
    type: PayOSPaymentIntentType;
    planPaymentId?: number;
    amountVnd: number;
    description: string;
    expiresAt?: Date | null;
  }): Promise<IntentWithTarget> {
    if (!this.provider.isConfigured()) {
      throw new ConflictException('Cổng thanh toán PayOS chưa được cấu hình.');
    }
    const idRow = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT nextval('"PayOSPaymentIntent_id_seq"') AS id
    `;
    const id = Number(idRow[0]?.id);
    if (!Number.isSafeInteger(id))
      throw new ConflictException(
        'Không tạo được mã đơn PayOS. Vui lòng thử lại.',
      );
    // PayOS order codes are merchant-global, not local database identifiers.
    // A fixed prefix based on the local sequence can collide with orders that
    // already exist in the merchant account. Keep the local id as a small
    // suffix while deriving the main part from the current epoch second.
    const orderCode = Math.floor(Date.now() / 1000) * 1000 + (id % 1000);
    return this.prisma.payOSPaymentIntent.create({
      data: {
        id,
        userId: data.userId,
        type: data.type,
        orderCode: BigInt(orderCode),
        planPaymentId: data.planPaymentId,
        amountVnd: data.amountVnd,
        description: data.description.slice(0, 25),
        expiresAt: data.expiresAt ?? null,
      },
      include: { planPayment: true },
    });
  }

  private async createProviderLink(
    intent: IntentWithTarget,
    itemName: string,
  ): Promise<PayosIntentDto> {
    const result: PayosPaymentResult = await this.provider.createPayment({
      orderCode: Number(intent.orderCode),
      amount: intent.amountVnd,
      description: intent.description,
      itemName: itemName.slice(0, 25),
      returnUrl: this.returnUrl(intent),
      cancelUrl: this.cancelUrl(intent),
      // PayOS refuses an expiry in the past.
      expiredAt:
        intent.expiresAt && intent.expiresAt.getTime() > Date.now()
          ? Math.floor(intent.expiresAt.getTime() / 1000)
          : undefined,
    });
    const updated = await this.prisma.payOSPaymentIntent.update({
      where: { id: intent.id },
      data: {
        paymentLinkId: result.paymentLinkId,
        checkoutUrl: result.checkoutUrl,
        qrCode: result.qrCode,
        bankBin: result.bankBin,
        bankAccountNumber: result.bankAccountNumber,
        bankAccountName: result.bankAccountName,
        providerStatus: result.status,
        status: this.mapStatus(result.status),
        expiresAt: result.expiresAt,
      },
      include: { planPayment: true },
    });
    return this.toDto(updated);
  }

  private returnUrl(intent: IntentWithTarget): string {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    return `${base}/hub?tab=account-plan&intent=${intent.id}`;
  }

  private cancelUrl(intent: IntentWithTarget): string {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    return `${base}/hub?tab=account-plan&intent=${intent.id}&cancelled=1`;
  }

  private mapStatus(status: string): PayOSPaymentIntentStatus {
    switch (status) {
      case 'PAID':
        return PayOSPaymentIntentStatus.PAID;
      case 'CANCELLED':
        return PayOSPaymentIntentStatus.CANCELLED;
      case 'EXPIRED':
        return PayOSPaymentIntentStatus.EXPIRED;
      case 'UNDERPAID':
        return PayOSPaymentIntentStatus.UNDERPAID;
      case 'PROCESSING':
        return PayOSPaymentIntentStatus.PROCESSING;
      case 'FAILED':
        return PayOSPaymentIntentStatus.FAILED;
      default:
        return PayOSPaymentIntentStatus.PENDING;
    }
  }

  private toDto(intent: IntentWithTarget): PayosIntentDto {
    return {
      intentId: intent.id,
      type: intent.type,
      orderCode: Number(intent.orderCode),
      description: intent.description,
      paymentLinkId: intent.paymentLinkId,
      checkoutUrl: intent.checkoutUrl,
      qrCode: intent.qrCode,
      bankBin: intent.bankBin,
      bankAccountNumber: intent.bankAccountNumber,
      bankAccountName: intent.bankAccountName,
      status: intent.status,
      expiresAt: intent.expiresAt,
    };
  }

  /**
   * Status polling is a server-side recovery path, not merely a display
   * refresh. Resolve the canonical fulfillment services lazily to avoid a
   * PaymentModule <-> SubscriptionModule construction cycle.
   */
  private async fulfill(intent: IntentWithTarget): Promise<void> {
    if (intent.type === PayOSPaymentIntentType.PLAN && intent.planPayment) {
      const plans = this.moduleRef.get<{
        confirmPurchaseFromWebhook: (
          purchaseId: number,
          bankTransactionId?: number,
        ) => Promise<unknown>;
      }>('PlanPurchaseService', {
        strict: false,
      });
      await plans.confirmPurchaseFromWebhook(intent.planPayment.planPurchaseId);
      return;
    }
  }
}
