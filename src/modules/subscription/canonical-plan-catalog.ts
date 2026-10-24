import {
  EntitlementUnit,
  PlanFeatureKey,
  PlanStatus,
  PlanVersionStatus,
  PrismaClient,
} from '@prisma/client';

type CanonicalPlan = {
  code: 'FREE' | 'PLUS' | 'PRO';
  displayName: string;
  description: string;
  versionName: string;
  durationDays: number | null;
  priceVnd: number;
  features: PlanFeatureKey[];
};

export const CANONICAL_PLAN_CATALOG: readonly CanonicalPlan[] = [
  {
    code: 'FREE',
    displayName: 'BreadTrans Free',
    description: 'Gói nền tảng miễn phí để bắt đầu tự học tiếng Anh.',
    versionName: 'BreadTrans Free',
    durationDays: null,
    priceVnd: 0,
    features: [],
  },
  {
    code: 'PLUS',
    displayName: 'BreadTrans Plus',
    description: 'Mở nội dung luyện kỹ năng nâng cao trong 30 ngày.',
    versionName: 'BreadTrans Plus — 30 ngày',
    durationDays: 30,
    priceVnd: 69_000,
    features: [
      PlanFeatureKey.PREMIUM_VOCAB,
      PlanFeatureKey.PREMIUM_READING,
      PlanFeatureKey.PREMIUM_LISTENING,
      PlanFeatureKey.PREMIUM_SPEAKING_CONTENT,
      PlanFeatureKey.PREMIUM_WRITING_CONTENT,
    ],
  },
  {
    code: 'PRO',
    displayName: 'BreadTrans Pro',
    description: 'Mở toàn bộ thư viện nội dung và khóa học trong 30 ngày.',
    versionName: 'BreadTrans Pro — 30 ngày',
    durationDays: 30,
    priceVnd: 149_000,
    features: [
      PlanFeatureKey.PREMIUM_VOCAB,
      PlanFeatureKey.PREMIUM_READING,
      PlanFeatureKey.PREMIUM_LISTENING,
      PlanFeatureKey.PREMIUM_SPEAKING_CONTENT,
      PlanFeatureKey.PREMIUM_WRITING_CONTENT,
      PlanFeatureKey.COURSE_LIBRARY_ACCESS,
    ],
  },
] as const;

const sameFeatures = (actual: PlanFeatureKey[], expected: PlanFeatureKey[]) =>
  actual.length === expected.length &&
  actual.every((feature) => expected.includes(feature));

/**
 * Make the current commercial catalog deterministic without rewriting rows
 * referenced by purchases or subscriptions. Historical versions remain intact;
 * a replacement version is created only when the current contract differs.
 */
export async function ensureCanonicalPlanCatalog(prisma: PrismaClient) {
  const now = new Date();
  const results: Array<{
    code: string;
    planId: number;
    versionId: number;
    version: number;
    createdVersion: boolean;
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const spec of CANONICAL_PLAN_CATALOG) {
      const plan = await tx.plan.upsert({
        where: { code: spec.code },
        create: {
          code: spec.code,
          displayName: spec.displayName,
          description: spec.description,
          status: PlanStatus.ACTIVE,
        },
        update: {
          displayName: spec.displayName,
          description: spec.description,
          status: PlanStatus.ACTIVE,
        },
      });
      const current = await tx.planVersion.findMany({
        where: {
          planId: plan.id,
          isCurrent: true,
          status: PlanVersionStatus.PUBLISHED,
        },
        include: { entitlements: { where: { enabled: true } } },
        orderBy: { version: 'desc' },
      });
      const matching = current.find(
        (version) =>
          version.durationDays === spec.durationDays &&
          version.priceVnd === spec.priceVnd &&
          version.currency === 'VND' &&
          sameFeatures(
            version.entitlements.map((item) => item.featureKey),
            [...spec.features],
          ),
      );
      if (matching) {
        results.push({
          code: spec.code,
          planId: plan.id,
          versionId: matching.id,
          version: matching.version,
          createdVersion: false,
        });
        continue;
      }

      const latest = await tx.planVersion.aggregate({
        where: { planId: plan.id },
        _max: { version: true },
      });
      await tx.planVersion.updateMany({
        where: { planId: plan.id, isCurrent: true },
        data: { isCurrent: false },
      });
      const version = await tx.planVersion.create({
        data: {
          planId: plan.id,
          version: (latest._max.version ?? 0) + 1,
          displayName: spec.versionName,
          description: spec.description,
          durationDays: spec.durationDays,
          priceVnd: spec.priceVnd,
          currency: 'VND',
          status: PlanVersionStatus.PUBLISHED,
          isCurrent: true,
          effectiveFrom: now,
          publishedAt: now,
          entitlements: {
            // CONTENT_ACCESS is a boolean gate, so it must carry neither a
            // limit nor a period: validatePlanEntitlementInput rejects either,
            // which would make the whole PlanVersion unpurchasable and render
            // the plan as "Chưa mở bán" in the public catalog.
            create: spec.features.map((featureKey) => ({
              featureKey,
              enabled: true,
              limitValue: null,
              unit: EntitlementUnit.CONTENT_ACCESS,
              period: null,
            })),
          },
        },
      });
      results.push({
        code: spec.code,
        planId: plan.id,
        versionId: version.id,
        version: version.version,
        createdVersion: true,
      });
    }
  });

  return results;
}
