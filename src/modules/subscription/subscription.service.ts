import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EntitlementPeriod,
  EntitlementUnit,
  PlanFeatureKey,
  PlanStatus,
  PlanVersionStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isPlanFeatureKey, PLAN_FEATURE_KEYS } from './subscription.constants';

type PlanVersionWithDetails = Prisma.PlanVersionGetPayload<{
  include: { plan: true; entitlements: true };
}>;

type PlanVersionWithPlan = Prisma.PlanVersionGetPayload<{
  include: { plan: true };
}>;

export interface PlanVersionValidationInput {
  version: number;
  durationDays?: number | null;
  priceVnd?: number | null;
  currency: string;
  status: PlanVersionStatus;
  isCurrent: boolean;
}

export interface PlanEntitlementValidationInput {
  enabled: boolean;
  limitValue?: number | null;
  unit?: EntitlementUnit | null;
  period?: EntitlementPeriod | null;
  scope?: unknown;
}

export interface SubscriptionValidationInput {
  userId: number;
  planVersionId: number;
  startsAt: Date;
  endsAt: Date;
}

export interface EffectivePlanEntitlement {
  featureKey: PlanFeatureKey;
  enabled: boolean;
  limitValue: number | null;
  unit: EntitlementUnit | null;
  period: EntitlementPeriod | null;
  scope: Prisma.JsonValue | null;
}

export interface EffectivePlan {
  plan: {
    id: number;
    code: string;
    displayName: string;
    description: string | null;
  };
  planVersion: {
    id: number;
    version: number;
    displayName: string | null;
    description: string | null;
    durationDays: number | null;
    priceVnd: number | null;
    currency: string;
  };
  isPaid: boolean;
  subscription: {
    id: number;
    startsAt: Date;
    endsAt: Date;
    status: SubscriptionStatus;
  } | null;
  entitlements: EffectivePlanEntitlement[];
}

export interface EffectiveEntitlement {
  featureKey: PlanFeatureKey;
  enabled: boolean;
  limitValue: number | null;
  unit: EntitlementUnit | null;
  period: EntitlementPeriod | null;
  scope: Prisma.JsonValue | null;
}

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveEffectivePlan(
    userId: number,
    now = new Date(),
  ): Promise<EffectivePlan> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      include: {
        planVersion: { include: { plan: true, entitlements: true } },
      },
      orderBy: { startsAt: 'asc' },
    });

    const paidSubscriptions = subscriptions.filter(
      (subscription) => subscription.planVersion.plan.code !== 'FREE',
    );

    if (paidSubscriptions.length > 1) {
      throw new ConflictException(
        'Multiple active subscriptions overlap for this user',
      );
    }

    if (paidSubscriptions.length === 1) {
      const subscription = paidSubscriptions[0];
      return this.toEffectivePlan(subscription.planVersion, true, {
        id: subscription.id,
        startsAt: subscription.startsAt,
        endsAt: subscription.endsAt,
        status: subscription.status,
      });
    }

    return this.resolveFreePlan(now);
  }

  validatePlanVersionInput(input: PlanVersionValidationInput): void {
    if (!Number.isInteger(input.version) || input.version <= 0) {
      throw new BadRequestException(
        'PlanVersion.version must be a positive integer',
      );
    }
    if (
      input.durationDays !== null &&
      input.durationDays !== undefined &&
      (!Number.isInteger(input.durationDays) || input.durationDays <= 0)
    ) {
      throw new BadRequestException(
        'PlanVersion.durationDays must be a positive integer',
      );
    }
    if (
      input.priceVnd !== null &&
      input.priceVnd !== undefined &&
      (!Number.isInteger(input.priceVnd) || input.priceVnd < 0)
    ) {
      throw new BadRequestException(
        'PlanVersion.priceVnd must be a non-negative integer',
      );
    }
    if (!input.currency.trim()) {
      throw new BadRequestException('PlanVersion.currency is required');
    }
    if (input.isCurrent && input.status !== PlanVersionStatus.PUBLISHED) {
      throw new BadRequestException(
        'Only a published PlanVersion may be current',
      );
    }
  }

  validatePlanEntitlementInput(input: PlanEntitlementValidationInput): void {
    const hasLimit =
      input.limitValue !== null && input.limitValue !== undefined;
    const hasUnit = input.unit !== null && input.unit !== undefined;
    const hasPeriod = input.period !== null && input.period !== undefined;
    const hasScope = input.scope !== null && input.scope !== undefined;

    if (
      hasScope &&
      (typeof input.scope !== 'object' || Array.isArray(input.scope))
    ) {
      throw new BadRequestException(
        'PlanEntitlement.scope must be a JSON object when provided',
      );
    }

    if (
      hasLimit &&
      (!Number.isInteger(input.limitValue) || input.limitValue! < 0)
    ) {
      throw new BadRequestException(
        'PlanEntitlement.limitValue must be a non-negative integer',
      );
    }
    if (!input.enabled) {
      if (hasLimit || hasUnit || hasPeriod || hasScope) {
        throw new BadRequestException(
          'Disabled entitlements must not carry quota metadata',
        );
      }
      return;
    }
    if (input.unit === EntitlementUnit.CONTENT_ACCESS) {
      if (hasLimit || hasPeriod) {
        throw new BadRequestException(
          'CONTENT_ACCESS cannot carry a numeric limit or period',
        );
      }
      return;
    }
    if (!hasLimit) {
      if (hasUnit || hasPeriod) {
        throw new BadRequestException(
          'Unlimited entitlements must not carry quota metadata',
        );
      }
      return;
    }
    if (input.limitValue === 0) {
      throw new BadRequestException(
        'Finite entitlement limits must be greater than zero',
      );
    }
    if (input.unit === null || input.unit === undefined) {
      throw new BadRequestException('Finite entitlements require a unit');
    }
    if (input.period === null || input.period === undefined) {
      throw new BadRequestException('Finite entitlements require a period');
    }
  }

  async assertPlanVersionMutable(planVersionId: number): Promise<void> {
    const [subscriptionCount, purchaseCount] = await Promise.all([
      this.prisma.subscription.count({ where: { planVersionId } }),
      this.prisma.planPurchase.count({ where: { planVersionId } }),
    ]);
    if (subscriptionCount > 0 || purchaseCount > 0) {
      throw new ConflictException(
        'A PlanVersion referenced by a PlanPurchase or Subscription is immutable',
      );
    }
  }

  async assertPlanEntitlementMutable(planVersionId: number): Promise<void> {
    await this.assertPlanVersionMutable(planVersionId);
  }

  /**
   * Shared guard for any future purchase/activation path.  A catalog version
   * is purchasable only when it is the active, current, published paid policy
   * with complete commercial terms and valid entitlement metadata.
   */
  async assertPurchasablePlanVersion(
    planVersionId: number,
  ): Promise<PlanVersionWithDetails> {
    const version = await this.prisma.planVersion.findUnique({
      where: { id: planVersionId },
      include: { plan: true, entitlements: true },
    });
    if (!version) {
      throw new NotFoundException('PlanVersion not found');
    }
    this.validatePurchasablePlanVersionRecord(version);
    return version;
  }

  /**
   * Applies the canonical saleability rules to an already-loaded version.
   * Public catalog discovery uses this same guard without issuing one query
   * per plan; purchase creation continues to call the database-backed guard
   * above immediately before creating a purchase.
   */
  validatePurchasablePlanVersionRecord(version: PlanVersionWithDetails): void {
    if (version.plan.code === 'FREE') {
      throw new ConflictException('FREE plan is not purchasable');
    }
    if (version.plan.status !== PlanStatus.ACTIVE) {
      throw new ConflictException('Plan is not active');
    }
    if (version.status !== PlanVersionStatus.PUBLISHED || !version.isCurrent) {
      throw new ConflictException(
        'Only the current published PlanVersion is purchasable',
      );
    }
    this.validatePlanVersionInput({
      version: version.version,
      durationDays: version.durationDays,
      priceVnd: version.priceVnd,
      currency: version.currency,
      status: version.status,
      isCurrent: version.isCurrent,
    });
    if (!version.durationDays || version.durationDays <= 0) {
      throw new ConflictException('Purchasable PlanVersion needs a duration');
    }
    if (!version.priceVnd || version.priceVnd <= 0) {
      throw new ConflictException(
        'Purchasable PlanVersion needs a positive price',
      );
    }
    if (version.currency !== 'VND') {
      throw new ConflictException('Only VND catalog versions are purchasable');
    }
    for (const entitlement of version.entitlements) {
      this.validatePlanEntitlementInput(entitlement);
    }
  }

  async validateSubscriptionInput(
    input: SubscriptionValidationInput,
  ): Promise<PlanVersionWithPlan> {
    if (!(input.startsAt instanceof Date) || !(input.endsAt instanceof Date)) {
      throw new BadRequestException(
        'Subscription dates must be valid Date values',
      );
    }
    if (input.endsAt <= input.startsAt) {
      throw new BadRequestException(
        'Subscription.endsAt must be after startsAt',
      );
    }

    const planVersion = await this.prisma.planVersion.findUnique({
      where: { id: input.planVersionId },
      include: { plan: true },
    });
    if (!planVersion) {
      throw new NotFoundException('PlanVersion not found');
    }
    if (planVersion.plan.code === 'FREE') {
      throw new ConflictException(
        'Paid subscriptions cannot target the FREE plan',
      );
    }
    if (planVersion.plan.status !== PlanStatus.ACTIVE) {
      throw new ConflictException('Plan is not active');
    }
    if (
      planVersion.status !== PlanVersionStatus.PUBLISHED ||
      !planVersion.isCurrent
    ) {
      throw new ConflictException(
        'Only the current published PlanVersion may be assigned',
      );
    }
    if (
      planVersion.effectiveFrom &&
      planVersion.effectiveFrom > input.startsAt
    ) {
      throw new ConflictException(
        'Subscription cannot start before its PlanVersion is effective',
      );
    }

    const overlappingCount = await this.prisma.subscription.count({
      where: {
        userId: input.userId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
    });
    if (overlappingCount > 0) {
      throw new ConflictException(
        'Subscription overlaps an existing active subscription',
      );
    }
    return planVersion;
  }

  async resolveEntitlement(
    userId: number,
    featureKey: PlanFeatureKey,
    now = new Date(),
  ): Promise<EffectiveEntitlement> {
    if (!isPlanFeatureKey(String(featureKey))) {
      throw new ConflictException(
        `Unknown plan feature key: ${String(featureKey)}`,
      );
    }

    const plan = await this.resolveEffectivePlan(userId, now);
    const entitlement = plan.entitlements.find(
      (candidate) => candidate.featureKey === featureKey,
    );

    return (
      entitlement ?? {
        featureKey,
        enabled: false,
        limitValue: null,
        unit: null,
        period: null,
        scope: null,
      }
    );
  }

  async hasFeature(
    userId: number,
    featureKey: PlanFeatureKey,
    now = new Date(),
  ): Promise<boolean> {
    return (await this.resolveEntitlement(userId, featureKey, now)).enabled;
  }

  private async resolveFreePlan(now: Date): Promise<EffectivePlan> {
    const freeVersions = await this.prisma.planVersion.findMany({
      where: {
        plan: { code: 'FREE', status: PlanStatus.ACTIVE },
        isCurrent: true,
        status: PlanVersionStatus.PUBLISHED,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
      },
      include: { plan: true, entitlements: true },
    });

    if (freeVersions.length !== 1) {
      throw new ServiceUnavailableException(
        freeVersions.length === 0
          ? 'FREE plan catalog is not configured'
          : 'FREE plan catalog is ambiguous',
      );
    }

    return this.toEffectivePlan(freeVersions[0], false, null);
  }

  private toEffectivePlan(
    version: PlanVersionWithDetails,
    isPaid: boolean,
    subscription: EffectivePlan['subscription'],
  ): EffectivePlan {
    return {
      plan: {
        id: version.plan.id,
        code: version.plan.code,
        displayName: version.plan.displayName,
        description: version.plan.description,
      },
      planVersion: {
        id: version.id,
        version: version.version,
        displayName: version.displayName,
        description: version.description,
        durationDays: version.durationDays,
        priceVnd: version.priceVnd,
        currency: version.currency,
      },
      isPaid,
      subscription,
      entitlements: PLAN_FEATURE_KEYS.map((featureKey) => {
        const entitlement = version.entitlements.find(
          (candidate) => candidate.featureKey === featureKey,
        );
        return (
          entitlement ?? {
            featureKey,
            enabled: false,
            limitValue: null,
            unit: null,
            period: null,
            scope: null,
          }
        );
      }),
    };
  }
}
