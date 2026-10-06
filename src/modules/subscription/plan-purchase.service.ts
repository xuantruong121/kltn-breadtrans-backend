import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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

type PurchaseWithDetails = Prisma.PlanPurchaseGetPayload<{
  include: {
    user: true;
    planVersion: { include: { plan: true; entitlements: true } };
    payment: true;
    subscription: true;
  };
}>;

@Injectable()
export class PlanPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
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

      const openPurchase = await tx.planPurchase.findFirst({
        where: {
          userId: studentId,
          planVersionId,
          status: PlanPurchaseStatus.PENDING_PAYMENT,
        },
        include: this.purchaseInclude,
        orderBy: { createdAt: 'desc' },
      });
      if (openPurchase) {
        return openPurchase;
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
      await tx.planPayment.create({
        data: {
          planPurchaseId: created.id,
          amountVnd: created.amountVnd,
          currency: created.currency,
          transferCode: `BT-PLAN-${created.id.toString().padStart(8, '0')}`,
        },
      });
      return tx.planPurchase.findUniqueOrThrow({
        where: { id: created.id },
        include: this.purchaseInclude,
      });
    });

    return this.toStudentDto(purchase);
  }

  async getMyPurchases(studentId: number): Promise<PlanPurchaseResponseDto[]> {
    const purchases = await this.prisma.planPurchase.findMany({
      where: { userId: studentId },
      include: this.purchaseInclude,
      orderBy: { createdAt: 'desc' },
    });
    return purchases.map((purchase) => this.toStudentDto(purchase));
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
    return this.toStudentDto(purchase);
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
      if (current.payment.status !== PlanPaymentStatus.REPORTED) {
        throw new ConflictException(
          `Only REPORTED plan payments can be confirmed (current: ${current.payment.status})`,
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
          confirmedById: adminId,
        },
      });
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
    });
    return this.toAdminDto(purchase);
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
    payment: true,
    subscription: true,
  } as const;

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
      bankInstructions: this.toBankInstructions(purchase.payment),
    };
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
