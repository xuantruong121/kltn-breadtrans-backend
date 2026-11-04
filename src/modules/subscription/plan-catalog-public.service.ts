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
    const closed: PublicPlanDto = {
      code: plan.code,
      displayName: plan.displayName,
      description: plan.description,
      purchasable: false,
      currentVersion: null,
      versions: [],
    };
    // FREE is a display-only baseline. Its PlanVersion ID must never become a
    // purchase target in the public contract.
    if (plan.code === 'FREE') return closed;

    // A plan sells one current version per term (30, 90, 180 days). Two
    // current versions of the same term are a data fault: neither is offered,
    // rather than choosing one arbitrarily.
    const byTerm = new Map<number | null, typeof plan.versions>();
    for (const version of plan.versions) {
      const list = byTerm.get(version.durationDays) ?? [];
      list.push(version);
      byTerm.set(version.durationDays, list);
    }
    const versions: PublicPlanVersionDto[] = [];
    for (const list of byTerm.values()) {
      if (list.length !== 1) continue;
      const version = list[0];
      try {
        this.subscriptionService.validatePurchasablePlanVersionRecord({
          ...version,
          plan,
        });
      } catch {
        // A malformed version fails closed rather than becoming a misleading
        // purchase choice. Admin repair remains the source of truth.
        continue;
      }
      versions.push({
        id: version.id,
        version: version.version,
        displayName: version.displayName,
        description: version.description,
        priceVnd: version.priceVnd!,
        currency: version.currency,
        durationDays: version.durationDays!,
      });
    }
    if (!versions.length) return closed;
    versions.sort((a, b) => a.durationDays - b.durationDays);

    return {
      ...closed,
      purchasable: true,
      currentVersion: versions[0],
      versions,
    };
  }
}
