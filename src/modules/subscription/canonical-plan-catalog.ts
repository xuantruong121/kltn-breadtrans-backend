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
  features: readonly PlanFeatureKey[];
};

const PAID_FEATURES = [
  PlanFeatureKey.PREMIUM_VOCAB,
  PlanFeatureKey.PREMIUM_READING,
  PlanFeatureKey.PREMIUM_LISTENING,
  PlanFeatureKey.PREMIUM_SPEAKING_CONTENT,
  PlanFeatureKey.PREMIUM_WRITING_CONTENT,
];

// What each plan gives (plan-limits.ts holds the numbers the checks use).
const PLUS_TEXT =
  'Mở Nói, Viết Trung cấp và Nghe chép mọi mức; AI chấm 30 bài mỗi ngày, sửa và nộp lại bài viết 2 lần mỗi bài, tặng 1 khiên giữ chuỗi mỗi 30 ngày.';
const PRO_TEXT =
  'Mở Nói, Viết mọi mức và đề TOEIC Speaking & Writing, 4 kỹ năng; AI chấm 60 bài mỗi ngày, sửa và nộp lại bài viết 5 lần mỗi bài, tặng 3 khiên giữ chuỗi mỗi 30 ngày.';

/**
 * Paid plans sell three terms. Longer terms are cheaper per day (owner,
 * 2026-11-04): 90 days at about -10% and 180 days at about -20% against
 * buying 30 days again and again, rounded down to the thousand.
 */
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
    description: `${PLUS_TEXT} Thời hạn 30 ngày.`,
    versionName: 'BreadTrans Plus — 30 ngày',
    durationDays: 30,
    priceVnd: 69_000,
    features: PAID_FEATURES,
  },
  {
    code: 'PLUS',
    displayName: 'BreadTrans Plus',
    description: `${PLUS_TEXT} Thời hạn 90 ngày, rẻ hơn khoảng 10% so với mua 3 lần 30 ngày.`,
    versionName: 'BreadTrans Plus — 90 ngày',
    durationDays: 90,
    priceVnd: 186_000,
    features: PAID_FEATURES,
  },
  {
    code: 'PLUS',
    displayName: 'BreadTrans Plus',
    description: `${PLUS_TEXT} Thời hạn 180 ngày, rẻ hơn khoảng 20% so với mua 6 lần 30 ngày.`,
    versionName: 'BreadTrans Plus — 180 ngày',
    durationDays: 180,
    priceVnd: 331_000,
    features: PAID_FEATURES,
  },
  {
    code: 'PRO',
    displayName: 'BreadTrans Pro',
    description: `${PRO_TEXT} Thời hạn 30 ngày.`,
    versionName: 'BreadTrans Pro — 30 ngày',
    durationDays: 30,
    priceVnd: 149_000,
    features: PAID_FEATURES,
  },
  {
    code: 'PRO',
    displayName: 'BreadTrans Pro',
    description: `${PRO_TEXT} Thời hạn 90 ngày, rẻ hơn khoảng 10% so với mua 3 lần 30 ngày.`,
    versionName: 'BreadTrans Pro — 90 ngày',
    durationDays: 90,
    priceVnd: 402_000,
    features: PAID_FEATURES,
  },
  {
    code: 'PRO',
    displayName: 'BreadTrans Pro',
    description: `${PRO_TEXT} Thời hạn 180 ngày, rẻ hơn khoảng 20% so với mua 6 lần 30 ngày.`,
    versionName: 'BreadTrans Pro — 180 ngày',
    durationDays: 180,
    priceVnd: 715_000,
    features: PAID_FEATURES,
  },
] as const;

const sameFeatures = (actual: PlanFeatureKey[], expected: PlanFeatureKey[]) =>
  actual.length === expected.length &&
  actual.every((feature) => expected.includes(feature));

/**
 * Make the current commercial catalog deterministic without rewriting rows
 * referenced by purchases or subscriptions. Historical versions remain intact;
 * a replacement version is created only when the current contract (price,
 * term, features) differs. The display text of the current version (name and
 * description) is not part of the contract: it is updated in place.
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
    const planIds = new Map<string, number>();
    for (const spec of CANONICAL_PLAN_CATALOG) {
      // The plan row takes its text from the first (shortest) term listed.
      const known = planIds.get(spec.code);
      const plan = known
        ? { id: known }
        : await tx.plan.upsert({
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
      planIds.set(spec.code, plan.id);
      const current = await tx.planVersion.findMany({
        where: {
          planId: plan.id,
          durationDays: spec.durationDays,
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
        if (
          matching.displayName !== spec.versionName ||
          matching.description !== spec.description
        )
          await tx.planVersion.update({
            where: { id: matching.id },
            data: {
              displayName: spec.versionName,
              description: spec.description,
            },
          });
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
      // Replace only the current version of this term; the other terms of
      // the same plan stay on sale.
      await tx.planVersion.updateMany({
        where: {
          planId: plan.id,
          durationDays: spec.durationDays,
          isCurrent: true,
        },
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
