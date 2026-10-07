import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PlanStatus, PlanVersionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePlanEntitlementDto,
  CreatePlanVersionDto,
  PlanCatalogAdminDto,
  PlanEntitlementAdminDto,
  PlanVersionAdminDto,
  UpdatePlanEntitlementDto,
  UpdatePlanVersionDto,
} from './dto/plan-catalog-admin.dto';
import { SubscriptionService } from './subscription.service';

type VersionWithDetails = Prisma.PlanVersionGetPayload<{
  include: { plan: true; entitlements: true };
}>;
type VersionWithEntitlements = Prisma.PlanVersionGetPayload<{
  include: { entitlements: true };
}>;

@Injectable()
export class PlanCatalogAdminService {
  private readonly logger = new Logger(PlanCatalogAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async listCatalog(): Promise<PlanCatalogAdminDto[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: { id: 'asc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: { entitlements: true },
        },
      },
    });
    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      displayName: plan.displayName,
      description: plan.description,
      status: plan.status,
      versions: plan.versions.map((version) =>
        this.toVersionDto(version, plan.code),
      ),
    }));
  }

  async getPlan(code: string): Promise<PlanCatalogAdminDto> {
    const plan = await this.prisma.plan.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: { entitlements: true },
        },
      },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return {
      id: plan.id,
      code: plan.code,
      displayName: plan.displayName,
      description: plan.description,
      status: plan.status,
      versions: plan.versions.map((version) =>
        this.toVersionDto(version, plan.code),
      ),
    };
  }

  async getVersion(id: number): Promise<PlanVersionAdminDto> {
    const version = await this.findVersion(id);
    return this.toVersionDto(version, version.plan.code);
  }

  async createDraft(
    planCode: string,
    dto: CreatePlanVersionDto,
    adminUserId: number,
  ): Promise<PlanVersionAdminDto> {
    const plan = await this.prisma.plan.findUnique({
      where: { code: planCode.toUpperCase() },
    });
    this.assertPaidPlan(plan?.code, plan?.status);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockPlan(tx, plan!.id);
      const latest = await tx.planVersion.findFirst({
        where: { planId: plan!.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      this.subscriptionService.validatePlanVersionInput({
        version,
        durationDays: dto.durationDays,
        priceVnd: dto.priceVnd,
        currency: dto.currency ?? 'VND',
        status: PlanVersionStatus.DRAFT,
        isCurrent: false,
      });
      const row = await tx.planVersion.create({
        data: {
          planId: plan!.id,
          version,
          displayName: dto.displayName,
          description: dto.description,
          durationDays: dto.durationDays,
          priceVnd: dto.priceVnd,
          currency: dto.currency ?? 'VND',
          status: PlanVersionStatus.DRAFT,
          isCurrent: false,
        },
        include: { plan: true, entitlements: true },
      });
      this.audit(adminUserId, 'CREATE_DRAFT', row.id, row.plan.code);
      return row;
    });
    return this.toVersionDto(created, created.plan.code);
  }

  async updateDraft(
    id: number,
    dto: UpdatePlanVersionDto,
    adminUserId: number,
  ): Promise<PlanVersionAdminDto> {
    const current = await this.findVersion(id);
    this.assertDraftMutable(current);
    await this.subscriptionService.assertPlanVersionMutable(id);
    const next = {
      durationDays: dto.durationDays ?? current.durationDays,
      priceVnd: dto.priceVnd ?? current.priceVnd,
      currency: dto.currency ?? current.currency,
    };
    this.subscriptionService.validatePlanVersionInput({
      version: current.version,
      durationDays: next.durationDays,
      priceVnd: next.priceVnd,
      currency: next.currency,
      status: current.status,
      isCurrent: current.isCurrent,
    });
    const updated = await this.prisma.planVersion.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        description: dto.description,
        durationDays: dto.durationDays,
        priceVnd: dto.priceVnd,
        currency: dto.currency,
      },
      include: { plan: true, entitlements: true },
    });
    this.audit(adminUserId, 'UPDATE_DRAFT', id, current.plan.code);
    return this.toVersionDto(updated, updated.plan.code);
  }

  async listEntitlements(id: number): Promise<PlanEntitlementAdminDto[]> {
    const version = await this.findVersion(id);
    return version.entitlements.map((entitlement) =>
      this.toEntitlementDto(entitlement),
    );
  }

  async validate(id: number): Promise<PlanVersionAdminDto> {
    const version = await this.findVersion(id);
    this.validateForPublish(version);
    return this.toVersionDto(version, version.plan.code);
  }

  async createEntitlement(
    versionId: number,
    dto: CreatePlanEntitlementDto,
    adminUserId: number,
  ): Promise<PlanEntitlementAdminDto> {
    const version = await this.findVersion(versionId);
    this.assertDraftMutable(version);
    await this.subscriptionService.assertPlanEntitlementMutable(versionId);
    this.subscriptionService.validatePlanEntitlementInput(dto);
    try {
      const entitlement = await this.prisma.planEntitlement.create({
        data: {
          planVersionId: versionId,
          featureKey: dto.featureKey,
          enabled: dto.enabled,
          limitValue: dto.limitValue,
          unit: dto.unit,
          period: dto.period,
          scope: dto.scope as Prisma.InputJsonValue | undefined,
        },
      });
      this.audit(
        adminUserId,
        'CREATE_ENTITLEMENT',
        versionId,
        version.plan.code,
      );
      return this.toEntitlementDto(entitlement);
    } catch (error) {
      this.rethrowUnique(
        error,
        'An entitlement for this feature already exists',
      );
      throw error;
    }
  }

  async updateEntitlement(
    versionId: number,
    entitlementId: number,
    dto: UpdatePlanEntitlementDto,
    adminUserId: number,
  ): Promise<PlanEntitlementAdminDto> {
    const version = await this.findVersion(versionId);
    this.assertDraftMutable(version);
    await this.subscriptionService.assertPlanEntitlementMutable(versionId);
    const current = await this.prisma.planEntitlement.findFirst({
      where: { id: entitlementId, planVersionId: versionId },
    });
    if (!current) {
      throw new NotFoundException('Plan entitlement not found');
    }
    const next = {
      enabled: dto.enabled ?? current.enabled,
      limitValue:
        dto.limitValue === undefined ? current.limitValue : dto.limitValue,
      unit: dto.unit === undefined ? current.unit : dto.unit,
      period: dto.period === undefined ? current.period : dto.period,
      scope: dto.scope === undefined ? current.scope : dto.scope,
    };
    this.subscriptionService.validatePlanEntitlementInput(next);
    const updated = await this.prisma.planEntitlement.update({
      where: { id: entitlementId },
      data: {
        enabled: dto.enabled,
        limitValue:
          dto.limitValue === undefined ? current.limitValue : dto.limitValue,
        unit: dto.unit === undefined ? current.unit : dto.unit,
        period: dto.period === undefined ? current.period : dto.period,
        scope: dto.scope as Prisma.InputJsonValue | undefined,
      },
    });
    this.audit(adminUserId, 'UPDATE_ENTITLEMENT', versionId, version.plan.code);
    return this.toEntitlementDto(updated);
  }

  async deleteEntitlement(
    versionId: number,
    entitlementId: number,
    adminUserId: number,
  ): Promise<{ deleted: true }> {
    const version = await this.findVersion(versionId);
    this.assertDraftMutable(version);
    await this.subscriptionService.assertPlanEntitlementMutable(versionId);
    const current = await this.prisma.planEntitlement.findFirst({
      where: { id: entitlementId, planVersionId: versionId },
    });
    if (!current) {
      throw new NotFoundException('Plan entitlement not found');
    }
    await this.prisma.planEntitlement.delete({ where: { id: entitlementId } });
    this.audit(adminUserId, 'DELETE_ENTITLEMENT', versionId, version.plan.code);
    return { deleted: true };
  }

  async publish(id: number, adminUserId: number): Promise<PlanVersionAdminDto> {
    const published = await this.prisma.$transaction(async (tx) => {
      const current = await tx.planVersion.findUnique({
        where: { id },
        include: { plan: true, entitlements: true },
      });
      if (!current) {
        throw new NotFoundException('PlanVersion not found');
      }
      this.validateForPublish(current);
      await this.lockPlan(tx, current.planId);
      await tx.planVersion.updateMany({
        where: { planId: current.planId, isCurrent: true, id: { not: id } },
        data: { isCurrent: false, status: PlanVersionStatus.RETIRED },
      });
      const row = await tx.planVersion.update({
        where: { id },
        data: {
          status: PlanVersionStatus.PUBLISHED,
          isCurrent: true,
          effectiveFrom: current.effectiveFrom ?? new Date(),
          publishedAt: new Date(),
        },
        include: { plan: true, entitlements: true },
      });
      this.audit(adminUserId, 'PUBLISH', id, current.plan.code);
      return row;
    });
    return this.toVersionDto(published, published.plan.code);
  }

  async retire(id: number, adminUserId: number): Promise<PlanVersionAdminDto> {
    const retired = await this.prisma.$transaction(async (tx) => {
      const current = await tx.planVersion.findUnique({
        where: { id },
        include: { plan: true, entitlements: true },
      });
      if (!current) {
        throw new NotFoundException('PlanVersion not found');
      }
      if (current.plan.code === 'FREE') {
        throw new ConflictException('FREE catalog versions are protected');
      }
      if (current.isCurrent) {
        throw new ConflictException(
          'Current PlanVersion must be replaced before retirement',
        );
      }
      if (current.status === PlanVersionStatus.RETIRED) {
        return current;
      }
      await this.lockPlan(tx, current.planId);
      const row = await tx.planVersion.update({
        where: { id },
        data: { status: PlanVersionStatus.RETIRED, isCurrent: false },
        include: { plan: true, entitlements: true },
      });
      this.audit(adminUserId, 'RETIRE', id, current.plan.code);
      return row;
    });
    return this.toVersionDto(retired, retired.plan.code);
  }

  private async findVersion(id: number): Promise<VersionWithDetails> {
    const version = await this.prisma.planVersion.findUnique({
      where: { id },
      include: { plan: true, entitlements: true },
    });
    if (!version) {
      throw new NotFoundException('PlanVersion not found');
    }
    return version;
  }

  private assertPaidPlan(code?: string, status?: PlanStatus): void {
    if (!code) {
      throw new NotFoundException('Plan not found');
    }
    if (code === 'FREE') {
      throw new ConflictException('FREE plan catalog is protected');
    }
    if (code !== 'PLUS' && code !== 'PRO') {
      throw new ConflictException(
        'Only PLUS and PRO plans are manageable here',
      );
    }
    if (status !== PlanStatus.ACTIVE) {
      throw new ConflictException('Plan is not active');
    }
  }

  private assertDraftMutable(version: VersionWithDetails): void {
    this.assertPaidPlan(version.plan.code, version.plan.status);
    if (version.status !== PlanVersionStatus.DRAFT || version.isCurrent) {
      throw new ConflictException(
        'Only non-current DRAFT versions are editable',
      );
    }
  }

  private validateForPublish(version: VersionWithDetails): void {
    this.assertDraftMutable(version);
    this.subscriptionService.validatePlanVersionInput({
      version: version.version,
      durationDays: version.durationDays,
      priceVnd: version.priceVnd,
      currency: version.currency,
      status: version.status,
      isCurrent: version.isCurrent,
    });
    if (!version.durationDays || version.durationDays <= 0) {
      throw new ConflictException(
        'Published paid versions require durationDays',
      );
    }
    if (!version.priceVnd || version.priceVnd <= 0) {
      throw new ConflictException(
        'Published paid versions require a positive priceVnd',
      );
    }
    if (version.currency !== 'VND') {
      throw new ConflictException(
        'Published paid versions require VND currency',
      );
    }
    for (const entitlement of version.entitlements) {
      this.subscriptionService.validatePlanEntitlementInput(entitlement);
    }
  }

  private async lockPlan(
    tx: Prisma.TransactionClient,
    planId: number,
  ): Promise<void> {
    await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT "id" FROM "Plan" WHERE "id" = ${planId} FOR UPDATE`,
    );
  }

  private rethrowUnique(error: unknown, message: string): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(message);
    }
  }

  private audit(
    adminUserId: number,
    action: string,
    versionId: number,
    planCode: string,
  ): void {
    this.logger.log({ adminUserId, action, versionId, planCode });
  }

  private toVersionDto(
    version: VersionWithDetails | VersionWithEntitlements,
    planCode: string,
  ): PlanVersionAdminDto {
    return {
      id: version.id,
      planId: version.planId,
      planCode,
      version: version.version,
      displayName: version.displayName,
      description: version.description,
      durationDays: version.durationDays,
      priceVnd: version.priceVnd,
      currency: version.currency,
      status: version.status,
      isCurrent: version.isCurrent,
      effectiveFrom: version.effectiveFrom,
      publishedAt: version.publishedAt,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      entitlements: version.entitlements.map((entitlement) =>
        this.toEntitlementDto(entitlement),
      ),
    };
  }

  private toEntitlementDto(
    entitlement: VersionWithDetails['entitlements'][number],
  ): PlanEntitlementAdminDto {
    return {
      id: entitlement.id,
      featureKey: entitlement.featureKey,
      enabled: entitlement.enabled,
      limitValue: entitlement.limitValue,
      unit: entitlement.unit,
      period: entitlement.period,
      scope: (entitlement.scope as Record<string, unknown> | null) ?? null,
    };
  }
}
