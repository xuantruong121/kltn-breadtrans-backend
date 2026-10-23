/**
 * Verify each plan's purchase precondition using the production guard
 * (SubscriptionService.assertPurchasablePlanVersion), resolving every plan by
 * semantic identity (Plan.code + isCurrent + PUBLISHED) rather than by a
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

const CANONICAL = {
  PLUS: { priceVnd: 69000, durationDays: 30 },
  PRO: { priceVnd: 149000, durationDays: 30 },
} as const;

async function main() {
  const prisma = new PrismaClient();
  const service = new SubscriptionService(prisma);
  let failures = 0;
  try {
    for (const code of ['FREE', 'PLUS', 'PRO'] as const) {
      const plan = await prisma.plan.findUnique({
        where: { code },
        include: {
          versions: {
            where: { isCurrent: true, status: PlanVersionStatus.PUBLISHED },
            include: { entitlements: true },
          },
        },
      });
      if (!plan) {
        console.log(`${code.padEnd(5)} MISSING plan`);
        failures++;
        continue;
      }
      const version = plan.versions[0];
      if (!version) {
        console.log(`${code.padEnd(5)} no current published version`);
        failures++;
        continue;
      }
      let verdict: string;
      try {
        await service.assertPurchasablePlanVersion(version.id);
        verdict = 'PURCHASABLE';
      } catch (error) {
        verdict = `REFUSED: ${error instanceof Error ? error.message : error}`;
      }
      console.log(
        `${code.padEnd(5)} planVersion=${String(version.id).padEnd(3)} v${version.version} ` +
          `${String(version.priceVnd).padEnd(7)}${version.currency} / ${version.durationDays ?? '-'}d ` +
          `entitlements=${String(version.entitlements.length).padEnd(2)} -> ${verdict}`,
      );

      // FREE must never be purchasable; paid plans must match canonical terms.
      if (code === 'FREE' && verdict === 'PURCHASABLE') {
        console.log('  ! FREE must not be purchasable');
        failures++;
      }
      if (code !== 'FREE') {
        if (verdict !== 'PURCHASABLE') failures++;
        const expected = CANONICAL[code];
        if (
          version.priceVnd !== expected.priceVnd ||
          version.durationDays !== expected.durationDays
        ) {
          console.log(
            `  ! ${code} terms differ from canonical: expected ${expected.priceVnd} VND / ${expected.durationDays}d`,
          );
          failures++;
        }
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
