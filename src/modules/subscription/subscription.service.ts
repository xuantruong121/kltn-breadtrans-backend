import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { planCodeOf, type PlanCode } from './plan-limits';
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
import {
  daysLeft,
  lockedAfterExpiry,
  type LockedGroup,
  type PracticedItem,
} from './expiry-summary.logic';
import { isDictationContent, type PracticeSkill } from './practice-level';

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

export interface ExpirySummary {
  isPaid: boolean;
  planCode: string;
  planName: string;
  endsAt: string | null;
  daysLeft: number | null;
  queuedRenewal: { planCode: string; startsAt: string; endsAt: string } | null;
  lockedAfterExpiry: LockedGroup[];
}

/** Standalone practice quiz types and their skill (Speaking is counted from sets). */
const SUMMARY_QUIZ_SKILL: Partial<Record<string, PracticeSkill>> = {
  LISTENING_PRACTICE: 'LISTENING',
  BILINGUAL_READING: 'READING',
  WRITING_PICTURE: 'WRITING',
  WRITING_EMAIL: 'WRITING',
};

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
  private readonly planLogger = new Logger(SubscriptionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The plan whose limits apply to this learner right now (plan-limits.ts).
   * A failed lookup answers FREE: a limit must never open because of an error.
   */
  async planCodeFor(userId: number): Promise<PlanCode> {
    try {
      return planCodeOf((await this.resolveEffectivePlan(userId)).plan.code);
    } catch (error) {
      this.planLogger.warn(
        `Plan lookup failed for ${userId}: ${String(error).slice(0, 160)}`,
      );
      return 'FREE';
    }
  }

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

  /**
   * What the running paid plan gives that FREE does not, for the screen shown
   * before it ends: days left, a queued renewal if any, and the paid practice
   * the learner used in this plan (distinct items, standalone practice only).
   */
  async getExpirySummary(
    userId: number,
    now = new Date(),
  ): Promise<ExpirySummary> {
    const effective = await this.resolveEffectivePlan(userId, now);
    if (!effective.isPaid || !effective.subscription) {
      return {
        isPaid: false,
        planCode: effective.plan.code,
        planName: effective.plan.displayName,
        endsAt: null,
        daysLeft: null,
        queuedRenewal: null,
        lockedAfterExpiry: [],
      };
    }
    const running = effective.subscription;
    const [queued, quizzes, speaking] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: {
          userId,
          status: SubscriptionStatus.ACTIVE,
          startsAt: { gte: running.endsAt },
          planVersion: { plan: { code: { not: 'FREE' } } },
        },
        include: { planVersion: { include: { plan: true } } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.submission.findMany({
        where: { userId, submittedAt: { gte: running.startsAt } },
        distinct: ['quizId'],
        select: {
          quiz: { select: { type: true, title: true, bilingualContent: true } },
        },
      }),
      this.prisma.speakingSubmission.findMany({
        where: { userId, submittedAt: { gte: running.startsAt } },
        distinct: ['exerciseId'],
        select: {
          exercise: {
            select: { practiceSet: { select: { level: true, scope: true } } },
          },
        },
      }),
    ]);
    const items: PracticedItem[] = [];
    for (const { quiz } of quizzes) {
      const skill = SUMMARY_QUIZ_SKILL[quiz.type];
      if (skill)
        items.push({
          skill,
          levelSource: quiz.title,
          dictation: isDictationContent(quiz.bilingualContent),
        });
    }
    for (const { exercise } of speaking) {
      const set = exercise.practiceSet;
      if (set?.scope === 'SKILL_PRACTICE')
        items.push({ skill: 'SPEAKING', levelSource: set.level });
    }
    return {
      isPaid: true,
      planCode: effective.plan.code,
      planName: effective.plan.displayName,
      endsAt: running.endsAt.toISOString(),
      daysLeft: daysLeft(running.endsAt, now),
      queuedRenewal: queued
        ? {
            planCode: queued.planVersion.plan.code,
            startsAt: queued.startsAt.toISOString(),
            endsAt: queued.endsAt.toISOString(),
          }
        : null,
      lockedAfterExpiry: lockedAfterExpiry(items),
    };
  }

  validatePlanVersionInput(input: PlanVersionValidationInput): void {
    if (!Number.isInteger(input.version) || input.version <= 0) {
      throw new BadRequestException('Số phiên bản phải là số nguyên dương.');
    }
    if (
      input.durationDays !== null &&
      input.durationDays !== undefined &&
      (!Number.isInteger(input.durationDays) || input.durationDays <= 0)
    ) {
      throw new BadRequestException('Số ngày sử dụng phải là số nguyên dương.');
    }
    if (
      input.priceVnd !== null &&
      input.priceVnd !== undefined &&
      (!Number.isInteger(input.priceVnd) || input.priceVnd < 0)
    ) {
      throw new BadRequestException('Giá phải là số nguyên không âm.');
    }
    if (!input.currency.trim()) {
      throw new BadRequestException('Thiếu đơn vị tiền tệ.');
    }
    if (input.isCurrent && input.status !== PlanVersionStatus.PUBLISHED) {
      throw new BadRequestException(
        'Chỉ phiên bản đã xuất bản mới được đặt làm hiện hành.',
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
        'Phạm vi quyền lợi phải là đối tượng JSON.',
      );
    }

    if (
      hasLimit &&
      (!Number.isInteger(input.limitValue) || input.limitValue! < 0)
    ) {
      throw new BadRequestException(
        'Hạn mức quyền lợi phải là số nguyên không âm.',
      );
    }
    if (!input.enabled) {
      if (hasLimit || hasUnit || hasPeriod || hasScope) {
        throw new BadRequestException(
          'Quyền lợi đã tắt không được có hạn mức.',
        );
      }
      return;
    }
    if (input.unit === EntitlementUnit.CONTENT_ACCESS) {
      if (hasLimit || hasPeriod) {
        throw new BadRequestException(
          'Quyền CONTENT_ACCESS không được có hạn mức hoặc chu kỳ.',
        );
      }
      return;
    }
    if (!hasLimit) {
      if (hasUnit || hasPeriod) {
        throw new BadRequestException(
          'Quyền lợi không giới hạn không được có hạn mức.',
        );
      }
      return;
    }
    if (input.limitValue === 0) {
      throw new BadRequestException('Hạn mức của quyền lợi phải lớn hơn 0.');
    }
    if (input.unit === null || input.unit === undefined) {
      throw new BadRequestException('Quyền lợi có hạn mức phải có đơn vị.');
    }
    if (input.period === null || input.period === undefined) {
      throw new BadRequestException('Quyền lợi có hạn mức phải có chu kỳ.');
    }
  }

  async assertPlanVersionMutable(planVersionId: number): Promise<void> {
    const [subscriptionCount, purchaseCount] = await Promise.all([
      this.prisma.subscription.count({ where: { planVersionId } }),
      this.prisma.planPurchase.count({ where: { planVersionId } }),
    ]);
    if (subscriptionCount > 0 || purchaseCount > 0) {
      throw new ConflictException(
        'Phiên bản gói đã có giao dịch hoặc đăng ký nên không thể sửa.',
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
      throw new NotFoundException('Không tìm thấy phiên bản gói.');
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
      throw new ConflictException('Phiên bản gói đang bán phải có thời hạn.');
    }
    if (!version.priceVnd || version.priceVnd <= 0) {
      throw new ConflictException(
        'Phiên bản gói đang bán phải có giá lớn hơn 0.',
      );
    }
    if (version.currency !== 'VND') {
      throw new ConflictException('Chỉ bán được phiên bản dùng đơn vị VND.');
    }
    for (const entitlement of version.entitlements) {
      this.validatePlanEntitlementInput(entitlement);
    }
  }

  async validateSubscriptionInput(
    input: SubscriptionValidationInput,
  ): Promise<PlanVersionWithPlan> {
    if (!(input.startsAt instanceof Date) || !(input.endsAt instanceof Date)) {
      throw new BadRequestException('Ngày của gói đăng ký không hợp lệ.');
    }
    if (input.endsAt <= input.startsAt) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
    }

    const planVersion = await this.prisma.planVersion.findUnique({
      where: { id: input.planVersionId },
      include: { plan: true },
    });
    if (!planVersion) {
      throw new NotFoundException('Không tìm thấy phiên bản gói.');
    }
    if (planVersion.plan.code === 'FREE') {
      throw new ConflictException(
        'Không thể gán đăng ký trả phí cho gói Free.',
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
        'Đăng ký không thể bắt đầu trước khi phiên bản gói có hiệu lực.',
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
        `Mã tính năng không xác định: ${String(featureKey)}.`,
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

  /** Code of the plan in effect now (FREE when no paid subscription is active). */
  async effectivePlanCode(userId: number, now = new Date()): Promise<string> {
    return (await this.resolveEffectivePlan(userId, now)).plan.code;
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
          ? 'Gói Free chưa được cấu hình.'
          : 'Có nhiều phiên bản gói Free đang hiệu lực.',
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
        const typedFeatureKey = featureKey as PlanFeatureKey;
        const entitlement = version.entitlements.find(
          (candidate) => candidate.featureKey === typedFeatureKey,
        );
        return (
          entitlement ?? {
            featureKey: typedFeatureKey,
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
