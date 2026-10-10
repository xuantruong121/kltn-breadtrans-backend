import {
  BadRequestException,
  ConflictException,
  Injectable,
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
  include: { planPayment: true; coursePayment: true };
}>;

@Injectable()
export class PayosPaymentService {
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
    if (!payment) throw new NotFoundException('PlanPayment not found');
    const existing = await this.prisma.payOSPaymentIntent.findUnique({
      where: { planPaymentId },
      include: { planPayment: true, coursePayment: true },
    });
    if (existing?.checkoutUrl && existing.qrCode) return this.toDto(existing);
    const intent =
      existing ??
      (await this.createIntent({
        userId,
        type: PayOSPaymentIntentType.PLAN,
        planPaymentId,
        amountVnd: payment.amountVnd,
        description: 'BreadTrans Plus',
      }));
    return this.createProviderLink(intent, itemName);
  }

  async createForCoursePayment(
    userId: number,
    enrollmentId: number,
    itemName: string,
  ): Promise<PayosIntentDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { enrollmentId, enrollment: { userId } },
      include: {
        enrollment: { include: { class: { include: { course: true } } } },
      },
    });
    if (!payment) throw new NotFoundException('Course payment not found');
    const existing = await this.prisma.payOSPaymentIntent.findUnique({
      where: { coursePaymentId: payment.id },
      include: { planPayment: true, coursePayment: true },
    });
    if (existing?.checkoutUrl && existing.qrCode) return this.toDto(existing);
    const intent =
      existing ??
      (await this.createIntent({
        userId,
        type: PayOSPaymentIntentType.COURSE,
        coursePaymentId: payment.id,
        amountVnd: payment.amountVnd,
        description: 'BreadTrans Course',
      }));
    return this.createProviderLink(intent, itemName);
  }

  async getOwnedIntent(
    userId: number,
    intentId: number,
  ): Promise<PayosIntentDto> {
    const intent = await this.prisma.payOSPaymentIntent.findFirst({
      where: { id: intentId, userId },
      include: { planPayment: true, coursePayment: true },
    });
    if (!intent) throw new NotFoundException('Payment intent not found');
    return this.toDto(intent);
  }

  async synchronize(orderCode: number): Promise<PayosIntentDto> {
    const intent = await this.findByOrderCode(orderCode);
    const remote = await this.provider.getPayment(orderCode);
    const status = this.mapStatus(remote.status);
    const updated = await this.prisma.payOSPaymentIntent.update({
      where: { id: intent.id },
      data: {
        status,
        providerStatus: remote.status,
        lastSyncedAt: new Date(),
        paidAt:
          status === PayOSPaymentIntentStatus.PAID
            ? (intent.paidAt ?? new Date())
            : intent.paidAt,
      },
      include: { planPayment: true, coursePayment: true },
    });
    if (status === PayOSPaymentIntentStatus.PAID) {
      await this.fulfill(updated);
    }
    return this.toDto(updated);
  }

  async cancel(
    userId: number,
    intentId: number,
    reason = 'Cancelled by learner',
  ) {
    const intent = await this.prisma.payOSPaymentIntent.findFirst({
      where: { id: intentId, userId },
      include: { planPayment: true, coursePayment: true },
    });
    if (!intent) throw new NotFoundException('Payment intent not found');
    if (intent.status === PayOSPaymentIntentStatus.PAID) {
      throw new ConflictException('A paid payment cannot be cancelled');
    }
    await this.provider.cancelPayment(Number(intent.orderCode), reason);
    const updated = await this.prisma.payOSPaymentIntent.update({
      where: { id: intent.id },
      data: {
        status: PayOSPaymentIntentStatus.CANCELLED,
        providerStatus: 'CANCELLED',
      },
      include: { planPayment: true, coursePayment: true },
    });
    return this.toDto(updated);
  }

  async resolveWebhook(payload: unknown): Promise<IntentWithTarget | null> {
    const data = await this.provider.verifyWebhook(payload);
    const intent = await this.prisma.payOSPaymentIntent.findUnique({
      where: { orderCode: BigInt(data.orderCode) },
      include: { planPayment: true, coursePayment: true },
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
    await this.prisma.payOSPaymentIntent.update({
      where: { id: intent.id },
      data: {
        status: PayOSPaymentIntentStatus.PAID,
        providerStatus: data.code,
        paymentLinkId: data.paymentLinkId || intent.paymentLinkId,
        paidAt: intent.paidAt ?? new Date(),
        lastSyncedAt: new Date(),
      },
    });
    return { ...intent, status: PayOSPaymentIntentStatus.PAID };
  }

  async findByOrderCode(orderCode: number): Promise<IntentWithTarget> {
    const intent = await this.prisma.payOSPaymentIntent.findUnique({
      where: { orderCode: BigInt(orderCode) },
      include: { planPayment: true, coursePayment: true },
    });
    if (!intent) throw new NotFoundException('PayOS orderCode is not mapped');
    return intent;
  }

  private async createIntent(data: {
    userId: number;
    type: PayOSPaymentIntentType;
    planPaymentId?: number;
    coursePaymentId?: number;
    amountVnd: number;
    description: string;
  }): Promise<IntentWithTarget> {
    if (!this.provider.isConfigured()) {
      throw new ConflictException('PayOS credentials are not configured');
    }
    const idRow = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT nextval('"PayOSPaymentIntent_id_seq"') AS id
    `;
    const id = Number(idRow[0]?.id);
    if (!Number.isSafeInteger(id))
      throw new ConflictException('Could not allocate PayOS orderCode');
    const orderCode = 900_000_000_000 + id;
    return this.prisma.payOSPaymentIntent.create({
      data: {
        id,
        userId: data.userId,
        type: data.type,
        orderCode: BigInt(orderCode),
        planPaymentId: data.planPaymentId,
        coursePaymentId: data.coursePaymentId,
        amountVnd: data.amountVnd,
        description: data.description.slice(0, 25),
      },
      include: { planPayment: true, coursePayment: true },
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
      expiredAt: intent.expiresAt
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
      include: { planPayment: true, coursePayment: true },
    });
    return this.toDto(updated);
  }

  private returnUrl(intent: IntentWithTarget): string {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    return `${base}/payment/return?intent=${intent.id}`;
  }

  private cancelUrl(intent: IntentWithTarget): string {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    return `${base}/payment/return?intent=${intent.id}&cancelled=1`;
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
    if (intent.type === PayOSPaymentIntentType.COURSE && intent.coursePayment) {
      const payments = this.moduleRef.get<{
        confirmPaymentFromPayos: (
          paymentId: number,
          providerAmountVnd: number,
        ) => Promise<unknown>;
      }>('PaymentService', {
        strict: false,
      });
      await payments.confirmPaymentFromPayos(
        intent.coursePayment.id,
        intent.amountVnd,
      );
    }
  }
}
