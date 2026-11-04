/**
 * Verify each plan's purchase precondition using the production guard
 * (SubscriptionService.assertPurchasablePlanVersion), resolving every plan by
 * semantic identity (Plan.code + term + isCurrent + PUBLISHED) rather than by a
 * historical PlanVersion id.
 *
 * This deliberately stops short of creating a purchase: POST /plan-purchases
 * calls PayOS, which is configured with live credentials here, so it would
 * create a real payment link at an external provider.
 *
 * Read-only.
 *
 * Usage: npx ts-node scripts/verify-plan-purchasability.ts
 */
import 'dotenv/config';
import { PlanVersionStatus, PrismaClient } from '@prisma/client';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';
import { CANONICAL_PLAN_CATALOG } from '../src/modules/subscription/canonical-plan-catalog';

async function main() {
  const prisma = new PrismaClient();
  const service = new SubscriptionService(prisma);
  let failures = 0;
  try {
    // One current published version per plan and term (30/90/180 days).
    for (const spec of CANONICAL_PLAN_CATALOG) {
      const label = `${spec.code} ${spec.durationDays ?? '-'}d`.padEnd(10);
      const versions = await prisma.planVersion.findMany({
        where: {
          plan: { code: spec.code },
          durationDays: spec.durationDays,
          isCurrent: true,
          status: PlanVersionStatus.PUBLISHED,
        },
        include: { entitlements: true },
      });
      if (versions.length !== 1) {
        console.log(
          `${label} ${versions.length} current published versions (expected 1)`,
        );
        failures++;
        continue;
      }
      const version = versions[0];
      let verdict: string;
      try {
        await service.assertPurchasablePlanVersion(version.id);
        verdict = 'PURCHASABLE';
      } catch (error) {
        verdict = `REFUSED: ${error instanceof Error ? error.message : error}`;
      }
      console.log(
        `${label} planVersion=${String(version.id).padEnd(3)} v${version.version} ` +
          `${String(version.priceVnd).padEnd(7)}${version.currency} ` +
          `entitlements=${String(version.entitlements.length).padEnd(2)} -> ${verdict}`,
      );

      // FREE must never be purchasable; paid plans must match canonical terms.
      if (spec.code === 'FREE') {
        if (verdict === 'PURCHASABLE') {
          console.log('  ! FREE must not be purchasable');
          failures++;
        }
        continue;
      }
      if (verdict !== 'PURCHASABLE') failures++;
      if (version.priceVnd !== spec.priceVnd) {
        console.log(
          `  ! price differs from canonical: expected ${spec.priceVnd} VND`,
        );
        failures++;
      }
    }
    console.log(
      `\nPLUS_PURCHASE_AVAILABILITY_VALID=${failures === 0}  (failures=${failures})`,
    );
    console.log(
      'checkout request creation NOT exercised: PayOS holds live credentials, so POST /plan-purchases would create a real external payment link.',
    );
  } finally {
    await prisma.$disconnect();
  }
  if (failures > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(
    'Purchasability verification failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
