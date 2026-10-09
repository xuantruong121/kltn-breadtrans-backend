import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PlanPaymentStatus,
  PlanPurchaseStatus,
  PlanStatus,
  PlanVersionStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildVietQrUrl } from '../payment/payment.service';
import { getPaymentBankConfig } from '../../common/config/payment-bank.config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PaginatedPlanPurchasesDto,
  PlanBankInstructionsDto,
  PlanPurchaseAdminDto,
  PlanPurchasePaymentDto,
  PlanPurchaseQueryDto,
  PlanPurchaseResponseDto,
} from './dto/plan-purchase.dto';
import { SubscriptionService } from './subscription.service';
import { PayosPaymentService } from '../payment/payos-payment.service';

type PurchaseWithDetails = Prisma.PlanPurchaseGetPayload<{
  include: {
    user: true;
    planVersion: { include: { plan: true; entitlements: true } };
    payment: { include: { payosIntent: true } };
    subscription: true;
  };
}>;

@Injectable()
export class PlanPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    @Optional() private readonly payos?: PayosPaymentService,
  ) {}

  async createPurchase(
    studentId: number,
    planVersionId: number,
    idempotencyKey: string,
  ): Promise<PlanPurchaseResponseDto> {
    const key = idempotencyKey.trim();
    if (!key) {
      throw new BadRequestException('idempotencyKey is required');
    }

    if (this.payos && !this.payos.isEnabled()) {
      throw new ConflictException('PayOS credentials are not configured');
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
      if (activePurchase) {
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

      const paidSubscription = await tx.subscription.findFirst({
        where: {
          userId: studentId,
          status: SubscriptionStatus.ACTIVE,
          endsAt: { gt: new Date() },
          planVersion: { plan: { code: { not: 'FREE' } } },
        },
      });
      if (paidSubscription) {
        throw new ConflictException(
          'An effective or scheduled paid Subscription already exists',
        );
      }

      const version = await tx.planVersion.findUnique({
        where: { id: planVersionId },
        include: { plan: true, entitlements: true },
      });
      if (!version) {
        throw new NotFoundException('PlanVersion not found');
      }
      this.assertPurchasableSnapshot(version);

      const created = await tx.planPurchase.create({
        data: {
          userId: studentId,
          planVersionId: version.id,
          amountVnd: version.priceVnd!,
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
      throw new ConflictException('PayOS credentials are not configured');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const owned = await tx.planPurchase.findFirst({
        where: { id: purchaseId, userId: studentId },
        select: { id: true },
      });
      if (!owned) {
        throw new NotFoundException('PlanPurchase not found');
      }

      await this.lockUser(tx, studentId);
      await this.lockPurchaseAndPayment(tx, purchaseId);
      const current = await tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: this.purchaseInclude,
      });
      if (!current.payment) {
        throw new UnprocessableEntityException('PlanPayment is missing');
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
          'A completed plan purchase cannot be replaced',
        );
      }
      if (current.payment.status === PlanPaymentStatus.REVIEW_REQUIRED) {
        throw new ConflictException(
          'This payment is under review and cannot be replaced',
        );
      }
      if (
        current.status !== PlanPurchaseStatus.PENDING_PAYMENT ||
        !this.isActivePaymentIntent(current)
      ) {
        throw new ConflictException(
          'Only an active payment intent can be replaced',
        );
      }

      const currentVersion = await tx.planVersion.findFirst({
        where: {
          planId: current.planVersion.planId,
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

      const created = await tx.planPurchase.create({
        data: {
          userId: studentId,
          planVersionId: currentVersion.id,
          amountVnd: currentVersion.priceVnd!,
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
      throw new NotFoundException('PlanPurchase not found');
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
        throw new NotFoundException('PlanPurchase not found');
      }
      await this.lockPurchaseAndPayment(tx, purchaseId);
      const current = await tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: this.purchaseInclude,
      });
      if (!current.payment) {
        throw new UnprocessableEntityException('PlanPayment is missing');
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
      throw new NotFoundException('PlanPurchase not found');
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
      throw new NotFoundException('PlanPurchase not found');
    }
    await this.lockUser(tx, hint.userId);
    await this.lockPurchaseAndPayment(tx, purchaseId);
    const current = await tx.planPurchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: this.purchaseInclude,
    });
    if (!current.payment) {
      throw new UnprocessableEntityException('PlanPayment is missing');
    }
    if (
      current.payment.planPurchaseId !== current.id ||
      current.payment.amountVnd !== current.amountVnd ||
      current.payment.currency !== current.currency
    ) {
      throw new ConflictException(
        'PlanPayment financial snapshot does not match PlanPurchase',
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
        `Only reported or review-required plan payments can be confirmed (current: ${current.payment.status})`,
      );
    }
    if (current.status !== PlanPurchaseStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        `Cannot confirm a ${current.status} purchase`,
      );
    }
    this.assertFrozenTerms(current);

    const startsAt = new Date();
    const endsAt = new Date(
      startsAt.getTime() + current.durationDays * 24 * 60 * 60 * 1000,
    );
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

    await tx.subscription.create({
      data: {
        userId: current.userId,
        planVersionId: current.planVersionId,
        planPurchaseId: current.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt,
        endsAt,
      },
    });
    await tx.planPayment.update({
      where: { id: current.payment.id },
      data: {
        status: PlanPaymentStatus.CONFIRMED,
        confirmedAt: startsAt,
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
        completedAt: startsAt,
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
      throw new BadRequestException('rejectionReason is required');
    }
    const purchase = await this.prisma.$transaction(async (tx) => {
      const hint = await tx.planPurchase.findUnique({
        where: { id: purchaseId },
        select: { userId: true },
      });
      if (!hint) {
        throw new NotFoundException('PlanPurchase not found');
      }
      await this.lockUser(tx, hint.userId);
      await this.lockPurchaseAndPayment(tx, purchaseId);
      const current = await tx.planPurchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: this.purchaseInclude,
      });
      if (!current.payment) {
        throw new UnprocessableEntityException('PlanPayment is missing');
      }
      if (
        current.status === PlanPurchaseStatus.REJECTED &&
        current.payment.status === PlanPaymentStatus.REJECTED
      ) {
        return current;
      }
      if (current.payment.status === PlanPaymentStatus.CONFIRMED) {
        throw new ConflictException(
          'A confirmed plan payment cannot be rejected',
        );
      }
      if (current.payment.status !== PlanPaymentStatus.REPORTED) {
        throw new ConflictException(
          `Only REPORTED plan payments can be rejected (current: ${current.payment.status})`,
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
  } as const;

  private readonly paymentIntentTtlMs =
    Number(process.env.PAYMENT_INTENT_TTL_MINUTES || 15) * 60 * 1000;

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
      return Boolean(
        payment?.payosIntent?.checkoutUrl &&
        payment?.payosIntent?.qrCode &&
        payment?.payosIntent?.bankBin &&
        payment?.payosIntent?.bankAccountNumber &&
        payment?.payosIntent?.bankAccountName,
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

  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );
    if (rows.length === 0) {
      throw new NotFoundException('User not found');
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
      throw new NotFoundException('PlanPurchase not found');
    }
    const paymentRows = await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT "id" FROM "PlanPayment" WHERE "planPurchaseId" = ${purchaseId} FOR UPDATE`,
    );
    if (paymentRows.length === 0) {
      throw new UnprocessableEntityException('PlanPayment is missing');
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

  private assertFrozenTerms(purchase: PurchaseWithDetails): void {
    const version = purchase.planVersion;
    if (
      version.plan.code === 'FREE' ||
      purchase.currency !== version.currency ||
      purchase.amountVnd !== version.priceVnd ||
      purchase.durationDays !== version.durationDays ||
      !version.priceVnd ||
      version.priceVnd <= 0 ||
      !version.durationDays ||
      version.durationDays <= 0 ||
      (version.status !== PlanVersionStatus.PUBLISHED &&
        version.status !== PlanVersionStatus.RETIRED)
    ) {
      throw new ConflictException(
        'Frozen PlanPurchase terms no longer match the purchased PlanVersion',
      );
    }
  }

  private toStudentDto(purchase: PurchaseWithDetails): PlanPurchaseResponseDto {
    if (!purchase.payment) {
      throw new UnprocessableEntityException('PlanPayment is missing');
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
      throw new UnprocessableEntityException('PlanPayment is missing');
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
  ): PlanBankInstructionsDto {
    if (!payment) {
      throw new UnprocessableEntityException('PlanPayment is missing');
    }
    const bank = getPaymentBankConfig();
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
