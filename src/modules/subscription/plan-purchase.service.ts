import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PayOSPaymentIntentStatus,
  PlanPaymentStatus,
  PlanPurchaseStatus,
  PlanStatus,
  PlanVersionStatus,
  Prisma,
  SubscriptionEventType,
  SubscriptionSource,
  SubscriptionStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildVietQrUrl } from '../payment/vietqr';
import { getPaymentBankConfig } from '../../common/config/payment-bank.config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PaginatedPlanPurchasesDto,
  PlanBankInstructionsDto,
  PlanPurchaseAdminDto,
  PlanPurchasePaymentDto,
  PlanPurchaseQueryDto,
  PlanPurchaseResponseDto,
  PromoPreviewDto,
  RenewalPreviewDto,
} from './dto/plan-purchase.dto';
import { SubscriptionService } from './subscription.service';
import { decideRenewal, type PaidTerm } from './renewal.logic';
import {
  evaluatePromo,
  frozenPriceHolds,
  normalizePromoCode,
} from './promo.logic';
import { PayosPaymentService } from '../payment/payos-payment.service';
import { ReferralService } from './referral.service';
import { grantPlanStreakFreezes } from './plan-streak-freezes';

type PurchaseWithDetails = Prisma.PlanPurchaseGetPayload<{
  include: {
    user: true;
    planVersion: { include: { plan: true; entitlements: true } };
    payment: { include: { payosIntent: true } };
    subscription: true;
    promoCode: true;
  };
}>;

export type StaleSweepResult = {
  expired: number;
  paid: number;
  review: number;
  open: number;
  failed: number;
};

@Injectable()
export class PlanPurchaseService {
  private readonly logger = new Logger(PlanPurchaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    @Optional() private readonly payos?: PayosPaymentService,
    @Optional() private readonly referrals?: ReferralService,
  ) {}

  async createPurchase(
    studentId: number,
    planVersionId: number,
    idempotencyKey: string,
    promoCode?: string | null,
  ): Promise<PlanPurchaseResponseDto> {
    const wantedCode = promoCode?.trim() ? normalizePromoCode(promoCode) : null;
    const key = idempotencyKey.trim();
    if (!key) {
      throw new BadRequestException('Thiếu mã chống trùng của yêu cầu.');
    }

    if (this.payos && !this.payos.isEnabled()) {
      throw new ConflictException('Cổng thanh toán PayOS chưa được cấu hình.');
    }

    await this.subscriptionService.assertPurchasablePlanVersion(planVersionId);

    const purchase = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, studentId);
      const existing = await tx.planPurchase.findUnique({
        where: {
          userId_idempotencyKey: { userId: studentId, idempotencyKey: key },
        },
        include: this.purchaseInclude,
      });
      if (existing) {
        if (existing.planVersionId !== planVersionId) {
          throw new ConflictException(
            'idempotencyKey was already used for another PlanVersion',
          );
        }
        return existing;
      }

      const openPurchases = await tx.planPurchase.findMany({
        where: {
          userId: studentId,
          planVersionId,
          status: PlanPurchaseStatus.PENDING_PAYMENT,
        },
        include: this.purchaseInclude,
        orderBy: { createdAt: 'desc' },
      });
      const activePurchase = openPurchases.find((candidate) =>
        this.isActivePaymentIntent(candidate),
      );
      // The open payment is reused only for the same code (or none): a learner
      // who adds or changes a code gets a new payment at the new price.
      if (
        activePurchase &&
        (activePurchase.promoCode?.code ?? null) === wantedCode
      ) {
        return activePurchase;
      }
      for (const stalePurchase of openPurchases) {
        if (stalePurchase.payment) {
          await this.expirePaymentIntent(
            tx,
            stalePurchase.id,
            stalePurchase.payment.id,
          );
        }
      }

      const version = await tx.planVersion.findUnique({
        where: { id: planVersionId },
        include: { plan: true, entitlements: true },
      });
      if (!version) {
        throw new NotFoundException('Không tìm thấy phiên bản gói.');
      }
      this.assertPurchasableSnapshot(version);

      // A learner with a running plan may renew (queued after it) or move up
      // (PRO now, PLUS days converted); renewal.logic decides, and refuses a
      // downgrade or a second queued plan before any payment is asked for.
      const decision = decideRenewal({
        now: new Date(),
        purchase: {
          planCode: version.plan.code,
          priceVnd: version.priceVnd!,
          durationDays: version.durationDays!,
        },
        paid: await this.paidTerms(tx, studentId, new Date()),
      });
      if (decision.kind === 'REFUSED') {
        throw new ConflictException(decision.message);
      }

      const price = await this.priceFor(tx, {
        studentId,
        version,
        code: wantedCode,
      });
      if (price.refusal) {
        throw new BadRequestException(price.refusal);
      }

      const created = await tx.planPurchase.create({
        data: {
          userId: studentId,
          planVersionId: version.id,
          listPriceVnd: price.listPriceVnd,
          discountVnd: price.discountVnd,
          promoCodeId: price.promoCodeId,
          amountVnd: price.amountVnd,
          currency: version.currency,
          durationDays: version.durationDays!,
          idempotencyKey: key,
        },
      });
      const bank = this.payos ? null : getPaymentBankConfig();
      const createdAt = created.createdAt;
      const paymentIntentExpiresAt = new Date(
        createdAt.getTime() + this.paymentIntentTtlMs,
      );
      const autoMatchUntil = this.payos?.isEnabled()
        ? null
        : new Date(createdAt.getTime() + this.autoMatchGraceMs);
      await tx.planPayment.create({
        data: {
          planPurchaseId: created.id,
          amountVnd: created.amountVnd,
          currency: created.currency,
          transferCode: `BTP${created.id.toString().padStart(8, '0')}`,
          bankBin: bank?.bin ?? null,
          bankName: bank?.bankName ?? null,
          bankAccountNumber: bank?.accountNumber ?? null,
          paymentIntentExpiresAt,
          autoMatchUntil,
        },
      });
      return tx.planPurchase.findUniqueOrThrow({
        where: { id: created.id },
        include: this.purchaseInclude,
      });
    });

    const response = this.toStudentDto(purchase);
    if (this.payos && purchase.payment) {
      response.payos = await this.payos.createForPlanPayment(
        studentId,
        purchase.payment.id,
        purchase.planVersion.displayName ??
          purchase.planVersion.plan.displayName,
      );
      response.bankInstructions = null;
    }
    return response;
  }

  async getMyPurchases(studentId: number): Promise<PlanPurchaseResponseDto[]> {
    const purchases = await this.prisma.planPurchase.findMany({
      where: { userId: studentId },
      include: this.purchaseInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      purchases.map((purchase) =>
        this.toStudentDtoWithPayos(purchase, studentId),
      ),
    );
  }

  async replacePayment(
    studentId: number,
    purchaseId: number,
  ): Promise<PlanPurchaseResponseDto> {
    if (this.payos && !this.payos.isEnabled()) {
      throw new ConflictException('Cổng thanh toán PayOS chưa được cấu hình.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const owned = await tx.planPurchase.findFirst({
        where: { id: purchaseId, userId: studentId },
        select: { id: true },
      });
      if (!owned) {
        throw new NotFoundException('Không tìm thấy giao dịch mua gói.');
      }

      await this.lockUser(tx, studentId);
      await this.lockPurchaseAndPayment(tx, purchaseId);
      const current = await tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: this.purchaseInclude,
      });
      if (!current.payment) {
        throw new UnprocessableEntityException(
          'Giao dịch thiếu thông tin thanh toán.',
        );
      }

      if (current.supersededByPurchaseId) {
        const replacement = await tx.planPurchase.findUnique({
          where: { id: current.supersededByPurchaseId },
          include: this.purchaseInclude,
        });
        if (replacement) return replacement;
      }
      if (
        current.status === PlanPurchaseStatus.COMPLETED ||
        current.payment.status === PlanPaymentStatus.CONFIRMED
      ) {
        throw new ConflictException(
          'Không thể thay thế giao dịch mua gói đã hoàn tất.',
        );
      }
      if (current.payment.status === PlanPaymentStatus.REVIEW_REQUIRED) {
        throw new ConflictException(
          'Khoản thanh toán đang được xem xét nên không thể thay thế.',
        );
      }
      if (
        current.status !== PlanPurchaseStatus.PENDING_PAYMENT ||
        !this.isActivePaymentIntent(current)
      ) {
        throw new ConflictException(
          'Chỉ thay thế được yêu cầu thanh toán còn hiệu lực.',
        );
      }

      const currentVersion = await tx.planVersion.findFirst({
        where: {
          planId: current.planVersion.planId,
          // A plan sells one current version per term: keep the same term.
          durationDays: current.planVersion.durationDays,
          isCurrent: true,
          status: PlanVersionStatus.PUBLISHED,
        },
        include: { plan: true, entitlements: true },
      });
      if (!currentVersion) {
        throw new ConflictException('Current PlanVersion is not purchasable');
      }
      this.subscriptionService.validatePurchasablePlanVersionRecord(
        currentVersion,
      );

      await tx.planPayment.update({
        where: { id: current.payment.id },
        data: {
          status: PlanPaymentStatus.SUPERSEDED,
          supersededAt: new Date(),
        },
      });
      await tx.planPurchase.update({
        where: { id: current.id },
        data: {
          status: PlanPurchaseStatus.SUPERSEDED,
          supersededAt: new Date(),
        },
      });

      // The code carries over while it is still valid for this learner;
      // otherwise the replacement is at the full current price.
      const price = await this.priceFor(tx, {
        studentId,
        version: currentVersion,
        promoCodeId: current.promoCodeId,
      });
      const created = await tx.planPurchase.create({
        data: {
          userId: studentId,
          planVersionId: currentVersion.id,
          listPriceVnd: price.listPriceVnd,
          discountVnd: price.discountVnd,
          promoCodeId: price.promoCodeId,
          amountVnd: price.amountVnd,
          currency: currentVersion.currency,
          durationDays: currentVersion.durationDays!,
          idempotencyKey: `replace:${purchaseId}:${randomUUID()}`,
        },
      });
      const bank = this.payos ? null : getPaymentBankConfig();
      const paymentIntentExpiresAt = new Date(
        created.createdAt.getTime() + this.paymentIntentTtlMs,
      );
      const autoMatchUntil = this.payos?.isEnabled()
        ? null
        : new Date(created.createdAt.getTime() + this.autoMatchGraceMs);
      await tx.planPayment.create({
        data: {
          planPurchaseId: created.id,
          amountVnd: created.amountVnd,
          currency: created.currency,
          transferCode: `BTP${created.id.toString().padStart(8, '0')}`,
          bankBin: bank?.bin ?? null,
          bankName: bank?.bankName ?? null,
          bankAccountNumber: bank?.accountNumber ?? null,
          paymentIntentExpiresAt,
          autoMatchUntil,
        },
      });
      await tx.planPurchase.update({
        where: { id: current.id },
        data: { supersededByPurchaseId: created.id },
      });
      return tx.planPurchase.findUniqueOrThrow({
        where: { id: created.id },
        include: this.purchaseInclude,
      });
    });

    const response = this.toStudentDto(result);
    if (this.payos && result.payment) {
      response.payos = await this.payos.createForPlanPayment(
        studentId,
        result.payment.id,
        result.planVersion.displayName ?? result.planVersion.plan.displayName,
      );
      response.bankInstructions = null;
    }
    return response;
  }

  async getMyPurchase(
    studentId: number,
    purchaseId: number,
  ): Promise<PlanPurchaseResponseDto> {
    const purchase = await this.prisma.planPurchase.findFirst({
      where: { id: purchaseId, userId: studentId },
      include: this.purchaseInclude,
    });
    if (!purchase) {
      throw new NotFoundException('Không tìm thấy giao dịch mua gói.');
    }
    return this.toStudentDtoWithPayos(purchase, studentId);
  }

  async reportTransfer(
    studentId: number,
    purchaseId: number,
  ): Promise<PlanPurchaseResponseDto> {
    const purchase = await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.planPurchase.findFirst({
        where: { id: purchaseId, userId: studentId },
        select: { id: true },
      });
      if (!candidate) {
        throw new NotFoundException('Không tìm thấy giao dịch mua gói.');
      }
      await this.lockPurchaseAndPayment(tx, purchaseId);
      const current = await tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: this.purchaseInclude,
      });
      if (!current.payment) {
        throw new UnprocessableEntityException(
          'Giao dịch thiếu thông tin thanh toán.',
        );
      }
      if (current.payment.status === PlanPaymentStatus.REPORTED) {
        return current;
      }
      if (current.payment.status !== PlanPaymentStatus.PENDING) {
        throw new ConflictException(
          `Cannot report transfer from ${current.payment.status} state`,
        );
      }
      if (current.status !== PlanPurchaseStatus.PENDING_PAYMENT) {
        throw new ConflictException(
          `Cannot report a ${current.status} purchase`,
        );
      }
      await tx.planPayment.update({
        where: { id: current.payment.id },
        data: { status: PlanPaymentStatus.REPORTED, reportedAt: new Date() },
      });
      return tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: this.purchaseInclude,
      });
    });
    return this.toStudentDto(purchase);
  }

  async listAdminPurchases(
    query: PlanPurchaseQueryDto,
  ): Promise<PaginatedPlanPurchasesDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.PlanPurchaseWhereInput = {
      status: query.status,
      ...(search
        ? {
            OR: [
              {
                payment: {
                  transferCode: { contains: search, mode: 'insensitive' },
                },
              },
              { user: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, purchases] = await Promise.all([
      this.prisma.planPurchase.count({ where }),
      this.prisma.planPurchase.findMany({
        where,
        include: this.purchaseInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      items: purchases.map((purchase) => this.toAdminDto(purchase)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAdminPurchase(purchaseId: number): Promise<PlanPurchaseAdminDto> {
    const purchase = await this.prisma.planPurchase.findUnique({
      where: { id: purchaseId },
      include: this.purchaseInclude,
    });
    if (!purchase) {
      throw new NotFoundException('Không tìm thấy giao dịch mua gói.');
    }
    return this.toAdminDto(purchase);
  }

  async confirmPurchase(
    purchaseId: number,
    adminId: number,
  ): Promise<PlanPurchaseAdminDto> {
    const purchase = await this.prisma.$transaction(async (tx) => {
      return this.confirmPurchaseInTransaction(tx, purchaseId, {
        source: 'ADMIN',
        actorId: adminId,
      });
    });
    return this.toAdminDto(purchase);
  }

  async confirmPurchaseFromWebhook(
    purchaseId: number,
    bankTransactionId?: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<PurchaseWithDetails> {
    if (transaction) {
      return this.confirmPurchaseInTransaction(transaction, purchaseId, {
        source: 'AUTO_WEBHOOK',
        bankTransactionId,
      });
    }
    return this.prisma.$transaction(async (tx) => {
      return this.confirmPurchaseInTransaction(tx, purchaseId, {
        source: 'AUTO_WEBHOOK',
        bankTransactionId,
      });
    });
  }

  private async confirmPurchaseInTransaction(
    tx: Prisma.TransactionClient,
    purchaseId: number,
    options: {
      source: 'ADMIN' | 'AUTO_WEBHOOK';
      actorId?: number;
      bankTransactionId?: number;
    },
  ): Promise<PurchaseWithDetails> {
    const hint = await tx.planPurchase.findUnique({
      where: { id: purchaseId },
      select: { userId: true },
    });
    if (!hint) {
      throw new NotFoundException('Không tìm thấy giao dịch mua gói.');
    }
    await this.lockUser(tx, hint.userId);
    await this.lockPurchaseAndPayment(tx, purchaseId);
    const current = await tx.planPurchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: this.purchaseInclude,
    });
    if (!current.payment) {
      throw new UnprocessableEntityException(
        'Giao dịch thiếu thông tin thanh toán.',
      );
    }
    if (
      current.payment.planPurchaseId !== current.id ||
      current.payment.amountVnd !== current.amountVnd ||
      current.payment.currency !== current.currency
    ) {
      throw new ConflictException(
        'Số liệu thanh toán không khớp với giao dịch mua gói.',
      );
    }
    if (
      current.status === PlanPurchaseStatus.COMPLETED &&
      current.payment.status === PlanPaymentStatus.CONFIRMED &&
      current.subscription
    ) {
      return current;
    }
    const canAutoConfirm =
      options.source === 'AUTO_WEBHOOK' &&
      (current.payment.status === PlanPaymentStatus.PENDING ||
        current.payment.status === PlanPaymentStatus.REPORTED);
    const canAdminConfirm =
      options.source === 'ADMIN' &&
      (current.payment.status === PlanPaymentStatus.REPORTED ||
        current.payment.status === PlanPaymentStatus.REVIEW_REQUIRED);
    if (!canAutoConfirm && !canAdminConfirm) {
      throw new ConflictException(
        `Chỉ xác nhận được khoản đã báo chuyển khoản hoặc cần xem xét (hiện tại: ${current.payment.status}).`,
      );
    }
    // A payment that reached PayOS after its purchase had expired waits for an
    // admin with the purchase left EXPIRED (see holdPaidPurchaseForReview), so
    // that it never blocks the learner's next purchase of the same plan.
    const lateReview =
      canAdminConfirm &&
      current.status === PlanPurchaseStatus.EXPIRED &&
      current.payment.status === PlanPaymentStatus.REVIEW_REQUIRED;
    if (current.status !== PlanPurchaseStatus.PENDING_PAYMENT && !lateReview) {
      throw new ConflictException(
        `Không thể xác nhận giao dịch ở trạng thái ${current.status}.`,
      );
    }
    this.assertFrozenTerms(current);

    // Decided again at confirmation: the plans may have changed since the
    // purchase was created (another payment confirmed, a plan ended).
    const confirmedAt = new Date();
    const decision = decideRenewal({
      now: confirmedAt,
      purchase: {
        planCode: current.planVersion.plan.code,
        // List price, so a discount never changes the conversion rate.
        priceVnd: current.listPriceVnd,
        durationDays: current.durationDays,
      },
      paid: await this.paidTerms(tx, current.userId, confirmedAt),
    });
    if (decision.kind === 'REFUSED') {
      throw new ConflictException(decision.message);
    }
    if (decision.kind === 'UPGRADE') {
      // The lower plan ends now; its remaining days are already in endsAt.
      await tx.subscription.update({
        where: { id: decision.endSubscriptionId },
        data: { endsAt: confirmedAt },
      });
    }
    const { startsAt, endsAt } = decision;
    // A running free trial ends when a real plan is paid for.
    await tx.subscription.updateMany({
      where: {
        userId: current.userId,
        source: SubscriptionSource.TRIAL,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: confirmedAt },
      },
      data: { endsAt: confirmedAt },
    });
    const existingSubscription = await tx.subscription.findFirst({
      where: {
        userId: current.userId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        planVersion: { plan: { code: { not: 'FREE' } } },
      },
    });
    if (existingSubscription) {
      throw new ConflictException(
        'An effective or scheduled paid Subscription already exists',
      );
    }

    const subscription = await tx.subscription.create({
      data: {
        userId: current.userId,
        planVersionId: current.planVersionId,
        planPurchaseId: current.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt,
        endsAt,
      },
    });
    // The streak freezes that come with the plan, once per purchase.
    await grantPlanStreakFreezes(tx, {
      userId: current.userId,
      planCode: current.planVersion.plan.code,
      durationDays: current.durationDays,
    });
    await this.referrals?.rewardOnFirstPayment(tx, current, confirmedAt);
    if (current.promoCodeId !== null && current.promoCodeId !== undefined) {
      // A paid purchase is honoured even if the code ran out meanwhile; the
      // redemption is what later counts toward the code's limits.
      await tx.promoRedemption.upsert({
        where: { planPurchaseId: current.id },
        create: {
          promoCodeId: current.promoCodeId,
          userId: current.userId,
          planPurchaseId: current.id,
          discountVnd: current.discountVnd,
        },
        update: {},
      });
    }
    if (tx.subscriptionEvent?.create) {
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          type: SubscriptionEventType.PAYMENT_ACTIVATED,
          actorUserId: options.actorId ?? null,
          reason:
            options.source === 'ADMIN'
              ? 'Xác nhận thanh toán thủ công bởi Quản trị viên'
              : 'Kích hoạt tự động qua cổng thanh toán',
          previousEndsAt: null,
          newEndsAt: endsAt,
          metadata: {
            planPurchaseId: current.id,
            paymentId: current.payment.id,
            source: options.source,
            placement: decision.kind,
            ...(decision.kind === 'RENEW'
              ? { queuedAfterSubscriptionId: decision.afterSubscriptionId }
              : {}),
            ...(decision.kind === 'UPGRADE'
              ? {
                  upgradedFromSubscriptionId: decision.endSubscriptionId,
                  upgradedFromPreviousEndsAt:
                    decision.previousEndsAt.toISOString(),
                  convertedDays:
                    Math.round((decision.convertedMs / 86_400_000) * 100) / 100,
                }
              : {}),
          },
        },
      });
    }
    await tx.planPayment.update({
      where: { id: current.payment.id },
      data: {
        status: PlanPaymentStatus.CONFIRMED,
        confirmedAt,
        confirmedById: options.actorId ?? null,
        confirmationSource: options.source,
      },
    });
    if (options.bankTransactionId !== undefined) {
      await tx.bankTransaction.update({
        where: { id: options.bankTransactionId },
        data: {
          matchedPlanPaymentId: current.payment.id,
          matchStatus: 'MATCHED',
        },
      });
    }
    await tx.planPurchase.update({
      where: { id: current.id },
      data: {
        status: PlanPurchaseStatus.COMPLETED,
        completedAt: confirmedAt,
      },
    });
    return tx.planPurchase.findUniqueOrThrow({
      where: { id: current.id },
      include: this.purchaseInclude,
    });
  }

  async rejectPurchase(
    purchaseId: number,
    adminId: number,
    reason: string,
  ): Promise<PlanPurchaseAdminDto> {
    const rejectionReason = reason.trim();
    if (!rejectionReason) {
      throw new BadRequestException('Vui lòng nhập lý do từ chối.');
    }
    const purchase = await this.prisma.$transaction(async (tx) => {
      const hint = await tx.planPurchase.findUnique({
        where: { id: purchaseId },
        select: { userId: true },
      });
      if (!hint) {
        throw new NotFoundException('Không tìm thấy giao dịch mua gói.');
      }
      await this.lockUser(tx, hint.userId);
      await this.lockPurchaseAndPayment(tx, purchaseId);
      const current = await tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: this.purchaseInclude,
      });
      if (!current.payment) {
        throw new UnprocessableEntityException(
          'Giao dịch thiếu thông tin thanh toán.',
        );
      }
      if (
        current.status === PlanPurchaseStatus.REJECTED &&
        current.payment.status === PlanPaymentStatus.REJECTED
      ) {
        return current;
      }
      if (current.payment.status === PlanPaymentStatus.CONFIRMED) {
        throw new ConflictException(
          'Không thể từ chối khoản thanh toán đã xác nhận.',
        );
      }
      // REVIEW_REQUIRED: money PayOS received that could not be applied
      // automatically; the admin refunds it outside the system and closes it.
      if (
        current.payment.status !== PlanPaymentStatus.REPORTED &&
        current.payment.status !== PlanPaymentStatus.REVIEW_REQUIRED
      ) {
        throw new ConflictException(
          `Chỉ từ chối được khoản đã báo chuyển khoản hoặc cần xử lý (hiện tại: ${current.payment.status}).`,
        );
      }
      await tx.planPayment.update({
        where: { id: current.payment.id },
        data: {
          status: PlanPaymentStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedById: adminId,
          rejectionReason,
        },
      });
      await tx.planPurchase.update({
        where: { id: current.id },
        data: { status: PlanPurchaseStatus.REJECTED },
      });
      return tx.planPurchase.findUniqueOrThrow({
        where: { id: current.id },
        include: this.purchaseInclude,
      });
    });
    return this.toAdminDto(purchase);
  }

  private readonly purchaseInclude = {
    user: true,
    planVersion: { include: { plan: true, entitlements: true } },
    payment: { include: { payosIntent: true } },
    subscription: true,
    promoCode: true,
  } as const;

  private readonly paymentIntentTtlMs =
    Number(process.env.PAYMENT_INTENT_TTL_MINUTES || 15) * 60 * 1000;

  // Time after the payment window before a purchase is closed, so a webhook
  // that arrives a little late still finds the purchase open.
  private readonly staleGraceMs =
    Number(process.env.PAYMENT_STALE_GRACE_MINUTES || 10) * 60 * 1000;

  private readonly autoMatchGraceMs =
    Number(process.env.SEPAY_LEGACY_AUTO_MATCH_GRACE_HOURS || 24) *
    60 *
    60 *
    1000;

  private isActivePaymentIntent(purchase: PurchaseWithDetails): boolean {
    const payment = purchase.payment;
    const now = Date.now();
    const commonValid = Boolean(
      purchase.status === PlanPurchaseStatus.PENDING_PAYMENT &&
      payment &&
      (payment.status === PlanPaymentStatus.PENDING ||
        payment.status === PlanPaymentStatus.REPORTED) &&
      /^BTP[0-9]{8}$/.test(payment.transferCode) &&
      payment.paymentIntentExpiresAt &&
      payment.paymentIntentExpiresAt.getTime() > now,
    );
    if (!commonValid) return false;
    if (this.payos?.isEnabled()) {
      const payosIntent = payment?.payosIntent;
      return Boolean(
        payosIntent &&
        (payosIntent.status === PayOSPaymentIntentStatus.PENDING ||
          payosIntent.status === PayOSPaymentIntentStatus.PROCESSING) &&
        (!payosIntent.expiresAt || payosIntent.expiresAt.getTime() > now) &&
        payosIntent.checkoutUrl &&
        payosIntent.qrCode &&
        payosIntent.bankBin &&
        payosIntent.bankAccountNumber &&
        payosIntent.bankAccountName,
      );
    }
    return Boolean(
      payment?.autoMatchUntil &&
      payment.autoMatchUntil.getTime() > now &&
      payment.bankAccountNumber,
    );
  }

  private async expirePaymentIntent(
    tx: Prisma.TransactionClient,
    purchaseId: number,
    paymentId: number,
  ): Promise<void> {
    await tx.planPayment.update({
      where: { id: paymentId },
      data: { status: PlanPaymentStatus.EXPIRED },
    });
    await tx.planPurchase.update({
      where: { id: purchaseId },
      data: { status: PlanPurchaseStatus.EXPIRED },
    });
  }

  /**
   * Closes purchases whose payment window passed without payment, so they stop
   * showing as "Chờ thanh toán". Runs every five minutes.
   *
   * A PayOS order is checked with PayOS before anything changes here: a paid
   * one is confirmed, a part-paid one waits for an admin, and a link still
   * open is cancelled first, so no payment can land on a purchase already
   * marked expired. When PayOS cannot be reached the purchase is left alone
   * and retried on the next run. A manual transfer (no PayOS order) expires
   * only after its auto-match window, since a late transfer can still match.
   */
  async expireStalePurchases(now = new Date()): Promise<StaleSweepResult> {
    const cutoff = new Date(now.getTime() - this.staleGraceMs);
    const stale = await this.prisma.planPurchase.findMany({
      where: {
        status: PlanPurchaseStatus.PENDING_PAYMENT,
        payment: {
          status: PlanPaymentStatus.PENDING,
          paymentIntentExpiresAt: { lt: cutoff },
          OR: [{ autoMatchUntil: null }, { autoMatchUntil: { lt: now } }],
        },
      },
      select: {
        id: true,
        payment: { select: { payosIntent: { select: { orderCode: true } } } },
      },
      orderBy: { id: 'asc' },
      take: 50,
    });
    const result: StaleSweepResult = {
      expired: 0,
      paid: 0,
      review: 0,
      open: 0,
      failed: 0,
    };
    for (const purchase of stale) {
      const orderCode = purchase.payment?.payosIntent?.orderCode;
      try {
        if (orderCode !== undefined && orderCode !== null) {
          if (!this.payos?.isEnabled()) {
            result.open += 1;
            continue;
          }
          const outcome = await this.payos.closeUnpaid(Number(orderCode));
          if (outcome === 'PAID') {
            result.paid += 1;
            continue;
          }
          if (outcome === 'OPEN') {
            result.open += 1;
            continue;
          }
          if (outcome === 'REVIEW') {
            if (await this.holdPaidPurchaseForReview(purchase.id))
              result.review += 1;
            continue;
          }
        }
        if (await this.expireIfStillPending(purchase.id)) result.expired += 1;
      } catch (caught) {
        let error = caught;
        // PayOS reported the order paid but confirming it failed (the plans
        // changed, a paid plan overlaps): the money waits for an admin.
        if (error instanceof ConflictException && orderCode != null) {
          try {
            if (await this.holdPaidPurchaseForReview(purchase.id))
              result.review += 1;
            continue;
          } catch (holdError) {
            error = holdError;
          }
        }
        result.failed += 1;
        this.logger.warn(
          `stale_purchase_sweep_failed purchaseId=${purchase.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
    return result;
  }

  /**
   * Money PayOS received that cannot be applied automatically: the purchase
   * had already expired, the amount was short, or confirming it failed. The
   * payment becomes REVIEW_REQUIRED for an admin to confirm or reject. The
   * purchase is EXPIRED either way, so it never blocks the learner's next
   * purchase of the same plan (one open purchase per plan version).
   */
  async holdPaidPurchaseForReview(purchaseId: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const hint = await tx.planPurchase.findUnique({
        where: { id: purchaseId },
        select: { userId: true },
      });
      if (!hint) return false;
      await this.lockUser(tx, hint.userId);
      await this.lockPurchaseAndPayment(tx, purchaseId);
      const current = await tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: { payment: true },
      });
      const payment = current.payment;
      if (
        !payment ||
        (current.status !== PlanPurchaseStatus.PENDING_PAYMENT &&
          current.status !== PlanPurchaseStatus.EXPIRED) ||
        (payment.status !== PlanPaymentStatus.PENDING &&
          payment.status !== PlanPaymentStatus.REPORTED &&
          payment.status !== PlanPaymentStatus.EXPIRED)
      ) {
        return false;
      }
      await tx.planPayment.update({
        where: { id: payment.id },
        data: { status: PlanPaymentStatus.REVIEW_REQUIRED },
      });
      await tx.planPurchase.update({
        where: { id: current.id },
        data: { status: PlanPurchaseStatus.EXPIRED },
      });
      this.logger.warn(
        `plan_payment_review_required purchaseId=${current.id} paymentId=${payment.id}`,
      );
      return true;
    });
  }

  private async expireIfStillPending(purchaseId: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const hint = await tx.planPurchase.findUnique({
        where: { id: purchaseId },
        select: { userId: true },
      });
      if (!hint) return false;
      await this.lockUser(tx, hint.userId);
      await this.lockPurchaseAndPayment(tx, purchaseId);
      const current = await tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: { payment: true },
      });
      if (
        !current.payment ||
        current.status !== PlanPurchaseStatus.PENDING_PAYMENT ||
        current.payment.status !== PlanPaymentStatus.PENDING
      ) {
        return false;
      }
      await this.expirePaymentIntent(tx, current.id, current.payment.id);
      return true;
    });
  }

  /** What buying this plan version now would do, shown before payment. */
  async previewRenewal(
    studentId: number,
    planVersionId: number,
  ): Promise<RenewalPreviewDto> {
    const version = await this.prisma.planVersion.findUnique({
      where: { id: planVersionId },
      include: { plan: true, entitlements: true },
    });
    if (!version) {
      throw new NotFoundException('Không tìm thấy phiên bản gói.');
    }
    this.assertPurchasableSnapshot(version);
    const now = new Date();
    const decision = decideRenewal({
      now,
      purchase: {
        planCode: version.plan.code,
        priceVnd: version.priceVnd!,
        durationDays: version.durationDays!,
      },
      paid: await this.paidTerms(this.prisma, studentId, now),
    });
    if (decision.kind === 'REFUSED') {
      return {
        kind: 'REFUSED',
        startsAt: null,
        endsAt: null,
        convertedDays: 0,
        message: decision.message,
      };
    }
    return {
      kind: decision.kind,
      startsAt: decision.startsAt.toISOString(),
      endsAt: decision.endsAt.toISOString(),
      convertedDays:
        decision.kind === 'UPGRADE'
          ? Math.round((decision.convertedMs / 86_400_000) * 100) / 100
          : 0,
      message: null,
    };
  }

  /** Paid ACTIVE plans not yet ended (running and queued), for renewal.logic. */
  private async paidTerms(
    tx: Prisma.TransactionClient,
    userId: number,
    now: Date,
  ): Promise<PaidTerm[]> {
    const rows = await tx.subscription.findMany({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
        // A free trial is not a paid plan: buying during it starts now.
        source: { not: SubscriptionSource.TRIAL },
        planVersion: { plan: { code: { not: 'FREE' } } },
      },
      include: { planVersion: { include: { plan: true } } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      planCode: row.planVersion.plan.code,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      priceVnd: row.planVersion.priceVnd,
      durationDays: row.planVersion.durationDays,
    }));
  }

  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );
    if (rows.length === 0) {
      throw new NotFoundException('Không tìm thấy tài khoản.');
    }
  }

  private async lockPurchaseAndPayment(
    tx: Prisma.TransactionClient,
    purchaseId: number,
  ): Promise<void> {
    const purchaseRows = await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT "id" FROM "PlanPurchase" WHERE "id" = ${purchaseId} FOR UPDATE`,
    );
    if (purchaseRows.length === 0) {
      throw new NotFoundException('Không tìm thấy giao dịch mua gói.');
    }
    const paymentRows = await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT "id" FROM "PlanPayment" WHERE "planPurchaseId" = ${purchaseId} FOR UPDATE`,
    );
    if (paymentRows.length === 0) {
      throw new UnprocessableEntityException(
        'Giao dịch thiếu thông tin thanh toán.',
      );
    }
  }

  private assertPurchasableSnapshot(
    version: Prisma.PlanVersionGetPayload<{
      include: { plan: true; entitlements: true };
    }>,
  ): void {
    if (
      version.plan.code === 'FREE' ||
      version.plan.status !== PlanStatus.ACTIVE ||
      version.status !== PlanVersionStatus.PUBLISHED ||
      !version.isCurrent ||
      version.currency !== 'VND' ||
      !version.priceVnd ||
      version.priceVnd <= 0 ||
      !version.durationDays ||
      version.durationDays <= 0
    ) {
      throw new ConflictException('PlanVersion is not purchasable');
    }
    this.subscriptionService.validatePlanVersionInput({
      version: version.version,
      durationDays: version.durationDays,
      priceVnd: version.priceVnd,
      currency: version.currency,
      status: version.status,
      isCurrent: version.isCurrent,
    });
    for (const entitlement of version.entitlements) {
      this.subscriptionService.validatePlanEntitlementInput(entitlement);
    }
  }

  /**
   * What the learner pays for `version`, with a promo code when given (by
   * code on a new purchase, by id on a replacement). The counts are taken
   * under a per-code lock, so the last use of a limited code is sold once.
   * A refused code leaves the full price and says why.
   */
  private async priceFor(
    tx: Prisma.TransactionClient,
    input: {
      studentId: number;
      version: { priceVnd: number | null; plan: { code: string } };
      code?: string | null;
      promoCodeId?: number | null;
    },
  ): Promise<{
    listPriceVnd: number;
    discountVnd: number;
    amountVnd: number;
    promoCodeId: number | null;
    percentOff: number | null;
    refusal: string | null;
  }> {
    const listPriceVnd = input.version.priceVnd!;
    const full = {
      listPriceVnd,
      discountVnd: 0,
      amountVnd: listPriceVnd,
      promoCodeId: null,
      percentOff: null,
      refusal: null,
    };
    if (!input.code && !input.promoCodeId) return full;
    const promo = input.code
      ? await tx.promoCode.findUnique({ where: { code: input.code } })
      : await tx.promoCode.findUnique({ where: { id: input.promoCodeId! } });
    let usedByUser = 0;
    let usedTotal = 0;
    if (promo) {
      const lockKey = `promo:${promo.id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const [mine, redeemed, openByOthers] = await Promise.all([
        tx.promoRedemption.count({
          where: { promoCodeId: promo.id, userId: input.studentId },
        }),
        tx.promoRedemption.count({ where: { promoCodeId: promo.id } }),
        tx.planPurchase.count({
          where: {
            promoCodeId: promo.id,
            status: PlanPurchaseStatus.PENDING_PAYMENT,
            userId: { not: input.studentId },
          },
        }),
      ]);
      usedByUser = mine;
      usedTotal = redeemed + openByOthers;
    }
    const decision = evaluatePromo({
      promo,
      now: new Date(),
      planCode: input.version.plan.code,
      userId: input.studentId,
      listPriceVnd,
      usedByUser,
      usedTotal,
    });
    if (!decision.ok) return { ...full, refusal: decision.message };
    return {
      listPriceVnd,
      discountVnd: decision.discountVnd,
      amountVnd: decision.amountVnd,
      promoCodeId: decision.promoCodeId,
      percentOff: decision.percentOff,
      refusal: null,
    };
  }

  /** The price of a plan version with a code, without buying anything. */
  async previewPromo(
    studentId: number,
    planVersionId: number,
    code: string,
  ): Promise<PromoPreviewDto> {
    const version = await this.prisma.planVersion.findUnique({
      where: { id: planVersionId },
      include: { plan: true },
    });
    if (!version || !version.priceVnd) {
      throw new NotFoundException('Không tìm thấy phiên bản gói.');
    }
    const normalized = normalizePromoCode(code);
    const price = await this.prisma.$transaction((tx) =>
      this.priceFor(tx, {
        studentId,
        version,
        code: normalized || null,
      }),
    );
    return {
      valid: !price.refusal && price.promoCodeId !== null,
      message: price.refusal,
      code: normalized,
      percentOff: price.percentOff,
      listPriceVnd: price.listPriceVnd,
      discountVnd: price.discountVnd,
      amountVnd: price.amountVnd,
    };
  }

  private assertFrozenTerms(purchase: PurchaseWithDetails): void {
    const version = purchase.planVersion;
    if (
      version.plan.code === 'FREE' ||
      purchase.currency !== version.currency ||
      !frozenPriceHolds({
        versionPriceVnd: version.priceVnd,
        listPriceVnd: purchase.listPriceVnd,
        discountVnd: purchase.discountVnd,
        amountVnd: purchase.amountVnd,
        promoCodeId: purchase.promoCodeId ?? null,
      }) ||
      purchase.durationDays !== version.durationDays ||
      !version.priceVnd ||
      version.priceVnd <= 0 ||
      !version.durationDays ||
      version.durationDays <= 0 ||
      (version.status !== PlanVersionStatus.PUBLISHED &&
        version.status !== PlanVersionStatus.RETIRED)
    ) {
      throw new ConflictException(
        'Điều khoản đã chốt của giao dịch không còn khớp với phiên bản gói đã mua.',
      );
    }
  }

  private toStudentDto(purchase: PurchaseWithDetails): PlanPurchaseResponseDto {
    if (!purchase.payment) {
      throw new UnprocessableEntityException(
        'Giao dịch thiếu thông tin thanh toán.',
      );
    }
    return {
      id: purchase.id,
      planVersionId: purchase.planVersionId,
      planCode: purchase.planVersion.plan.code,
      planDisplayName:
        purchase.planVersion.displayName ??
        purchase.planVersion.plan.displayName,
      version: purchase.planVersion.version,
      status: purchase.status,
      amountVnd: purchase.amountVnd,
      listPriceVnd: purchase.listPriceVnd ?? purchase.amountVnd,
      discountVnd: purchase.discountVnd ?? 0,
      promoCode: purchase.promoCode?.code ?? null,
      currency: purchase.currency,
      durationDays: purchase.durationDays,
      createdAt: purchase.createdAt,
      completedAt: purchase.completedAt,
      payment: this.toPaymentDto(purchase.payment),
      // PayOS is the active provider. Legacy bank instructions are only
      // materialized when the PayOS provider is not configured.
      bankInstructions: this.payos?.isEnabled()
        ? null
        : this.toBankInstructions(purchase.payment),
      payos: null,
      isActivePaymentIntent: this.isActivePaymentIntent(purchase),
      canReplace: this.isActivePaymentIntent(purchase),
      supersededAt: purchase.supersededAt,
      supersededByPurchaseId: purchase.supersededByPurchaseId,
    };
  }

  private async toStudentDtoWithPayos(
    purchase: PurchaseWithDetails,
    studentId: number,
  ): Promise<PlanPurchaseResponseDto> {
    const dto = this.toStudentDto(purchase);
    if (this.payos && purchase.payment) {
      const intent = await this.prisma.payOSPaymentIntent.findUnique({
        where: { planPaymentId: purchase.payment.id },
        select: { id: true },
      });
      if (intent)
        dto.payos = await this.payos.getOwnedIntent(studentId, intent.id);
      if (intent) dto.bankInstructions = null;
    }
    return dto;
  }

  private toAdminDto(purchase: PurchaseWithDetails): PlanPurchaseAdminDto {
    const student = this.toStudentDto(purchase);
    return {
      ...student,
      userId: purchase.userId,
      userEmail: purchase.user.email,
      confirmedById: purchase.payment?.confirmedById ?? null,
      rejectedById: purchase.payment?.rejectedById ?? null,
    };
  }

  private toPaymentDto(
    payment: PurchaseWithDetails['payment'],
  ): PlanPurchasePaymentDto {
    if (!payment) {
      throw new UnprocessableEntityException(
        'Giao dịch thiếu thông tin thanh toán.',
      );
    }
    return {
      id: payment.id,
      transferCode: payment.transferCode,
      status: payment.status,
      amountVnd: payment.amountVnd,
      currency: payment.currency,
      reportedAt: payment.reportedAt,
      confirmedAt: payment.confirmedAt,
      rejectedAt: payment.rejectedAt,
      rejectionReason: payment.rejectionReason,
      paymentIntentExpiresAt: payment.paymentIntentExpiresAt,
      autoMatchUntil: payment.autoMatchUntil,
      supersededAt: payment.supersededAt,
    };
  }

  private toBankInstructions(
    payment: PurchaseWithDetails['payment'],
  ): PlanBankInstructionsDto | null {
    if (!payment) {
      throw new UnprocessableEntityException(
        'Giao dịch thiếu thông tin thanh toán.',
      );
    }
    let bank: ReturnType<typeof getPaymentBankConfig>;
    try {
      bank = getPaymentBankConfig();
    } catch (error) {
      // A completed or manually-created payment must remain readable even when
      // this runtime does not offer the legacy bank-transfer channel (for
      // example in PayOS-only deployments and CI). Creation still validates
      // this configuration before issuing a manual-transfer payment.
      if (
        error instanceof Error &&
        error.message.startsWith('[Payment Config] Missing required')
      ) {
        return null;
      }
      throw error;
    }
    return {
      bin: bank.bin,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      amountVnd: payment.amountVnd,
      transferCode: payment.transferCode,
      vietQrUrl: buildVietQrUrl({
        bin: bank.bin,
        accountNumber: bank.accountNumber,
        amountVnd: payment.amountVnd,
        transferCode: payment.transferCode,
        accountName: bank.accountName,
      }),
    };
  }
}
