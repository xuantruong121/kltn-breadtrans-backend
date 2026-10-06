import { Injectable } from '@nestjs/common';
import { PlanStatus, PlanVersionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PublicPlanCatalogDto,
  PublicPlanDto,
  PublicPlanVersionDto,
} from './dto/plan-catalog-public.dto';
import { SubscriptionService } from './subscription.service';

type PublicPlanWithVersions = Prisma.PlanGetPayload<{
  include: {
    versions: {
      include: { entitlements: true };
    };
  };
}>;

const DISPLAY_ORDER: Record<string, number> = {
  FREE: 0,
  PLUS: 1,
  PRO: 2,
};

@Injectable()
export class PlanCatalogPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async getCatalog(): Promise<PublicPlanCatalogDto> {
    const plans = await this.prisma.plan.findMany({
      where: { status: PlanStatus.ACTIVE },
      orderBy: { code: 'asc' },
      include: {
        versions: {
          where: {
            status: PlanVersionStatus.PUBLISHED,
            isCurrent: true,
          },
          orderBy: { version: 'desc' },
          include: { entitlements: true },
        },
      },
    });

    const orderedPlans = plans
      .filter((plan) => plan.status === PlanStatus.ACTIVE)
      .sort(
        (left, right) =>
          (DISPLAY_ORDER[left.code] ?? Number.MAX_SAFE_INTEGER) -
            (DISPLAY_ORDER[right.code] ?? Number.MAX_SAFE_INTEGER) ||
          left.code.localeCompare(right.code),
      );

    return {
      plans: orderedPlans.map((plan) => this.toPublicPlan(plan)),
    };
  }

  private toPublicPlan(plan: PublicPlanWithVersions): PublicPlanDto {
    // FREE is a display-only baseline. Its PlanVersion ID must never become a
    // purchase target in the public contract.
    if (plan.code === 'FREE' || plan.versions.length !== 1) {
      return {
        code: plan.code,
        displayName: plan.displayName,
        description: plan.description,
        purchasable: false,
        currentVersion: null,
      };
    }

    const version = plan.versions[0];
    try {
      this.subscriptionService.validatePurchasablePlanVersionRecord({
        ...version,
        plan,
      });
    } catch {
      // A malformed current version fails closed rather than becoming a
      // misleading purchase choice. Admin repair remains the source of truth.
      return {
        code: plan.code,
        displayName: plan.displayName,
        description: plan.description,
        purchasable: false,
        currentVersion: null,
      };
    }

    const currentVersion: PublicPlanVersionDto = {
      id: version.id,
      version: version.version,
      displayName: version.displayName,
      description: version.description,
      priceVnd: version.priceVnd!,
      currency: version.currency,
      durationDays: version.durationDays!,
    };

    return {
      code: plan.code,
      displayName: plan.displayName,
      description: plan.description,
      purchasable: true,
      currentVersion,
    };
  }
}
