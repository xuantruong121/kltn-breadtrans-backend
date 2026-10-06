import {
  PlanPaymentStatus,
  PlanPurchaseStatus,
  PlanStatus,
  PlanVersionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanPurchaseService } from './plan-purchase.service';
import { SubscriptionService } from './subscription.service';

describe('PlanPurchaseService PostgreSQL concurrency', () => {
  let prisma: PrismaService;
  let service: PlanPurchaseService;
  let userId: number;
  let planId: number;
  let planVersionId: number;
  let secondPlanVersionId: number;
  const purchaseIds: number[] = [];
  const originalBankEnv = {
    bin: process.env.PAYMENT_BANK_BIN,
    name: process.env.PAYMENT_BANK_NAME,
    number: process.env.PAYMENT_BANK_ACCOUNT_NUMBER,
    accountName: process.env.PAYMENT_BANK_ACCOUNT_NAME,
  };

  beforeAll(async () => {
    process.env.PAYMENT_BANK_BIN = '970415';
    process.env.PAYMENT_BANK_NAME = 'Integration Test Bank';
    process.env.PAYMENT_BANK_ACCOUNT_NUMBER = '123456789';
    process.env.PAYMENT_BANK_ACCOUNT_NAME = 'BREADTRANS TEST';
    prisma = new PrismaService();
    await prisma.$connect();
    service = new PlanPurchaseService(prisma, new SubscriptionService(prisma));

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const user = await prisma.user.create({
      data: { email: `plan_purchase_concurrency_${suffix}@breadtrans.local` },
    });
    userId = user.id;
    const plan = await prisma.plan.create({
      data: {
        code: `TEST_PLUS_${suffix}`,
        displayName: 'Concurrency test plan',
        status: PlanStatus.ACTIVE,
      },
    });
    planId = plan.id;
    const version = await prisma.planVersion.create({
      data: {
        planId,
        version: 1,
        displayName: 'Concurrency test version',
        durationDays: 30,
        priceVnd: 99000,
        currency: 'VND',
        status: PlanVersionStatus.PUBLISHED,
        isCurrent: true,
        effectiveFrom: new Date(),
        publishedAt: new Date(),
      },
    });
    planVersionId = version.id;
    const secondVersion = await prisma.planVersion.create({
      data: {
        planId,
        version: 2,
        displayName: 'Concurrency test historical version',
        durationDays: 30,
        priceVnd: 99000,
        currency: 'VND',
        status: PlanVersionStatus.RETIRED,
        isCurrent: false,
      },
    });
    secondPlanVersionId = secondVersion.id;
  });

  afterEach(async () => {
    if (purchaseIds.length > 0) {
      await prisma.subscription.deleteMany({
        where: { planPurchaseId: { in: purchaseIds } },
      });
      await prisma.planPayment.deleteMany({
        where: { planPurchaseId: { in: purchaseIds } },
      });
      await prisma.planPurchase.deleteMany({
        where: { id: { in: purchaseIds } },
      });
      purchaseIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.planVersion.delete({ where: { id: secondPlanVersionId } });
    await prisma.planVersion.delete({ where: { id: planVersionId } });
    await prisma.plan.delete({ where: { id: planId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    restoreEnv('PAYMENT_BANK_BIN', originalBankEnv.bin);
    restoreEnv('PAYMENT_BANK_NAME', originalBankEnv.name);
    restoreEnv('PAYMENT_BANK_ACCOUNT_NUMBER', originalBankEnv.number);
    restoreEnv('PAYMENT_BANK_ACCOUNT_NAME', originalBankEnv.accountName);
  });

  it('fulfills one reported purchase exactly once under concurrent confirms', async () => {
    const purchaseId = await createReportedPurchase('same-purchase');

    const outcomes = await Promise.allSettled([
      service.confirmPurchase(purchaseId, userId),
      service.confirmPurchase(purchaseId, userId),
    ]);
    const purchase = await prisma.planPurchase.findUnique({
      where: { id: purchaseId },
      include: { payment: true, subscription: true },
    });

    expect(outcomes).toHaveLength(2);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(2);
    expect(purchase?.status).toBe(PlanPurchaseStatus.COMPLETED);
    expect(purchase?.payment?.status).toBe(PlanPaymentStatus.CONFIRMED);
    expect(purchase?.subscription).not.toBeNull();
    expect(
      await prisma.subscription.count({
        where: { planPurchaseId: purchaseId },
      }),
    ).toBe(1);
  });

  it('serializes two different purchases for the same user and rejects overlap', async () => {
    const firstId = await createReportedPurchase('different-first');
    const secondId = await createReportedPurchase(
      'different-second',
      secondPlanVersionId,
    );

    const outcomes = await Promise.allSettled([
      service.confirmPurchase(firstId, userId),
      service.confirmPurchase(secondId, userId),
    ]);
    const subscriptions = await prisma.subscription.findMany({
      where: {
        userId,
        planVersion: { plan: { code: { startsWith: 'TEST_PLUS_' } } },
      },
    });

    expect(outcomes).toHaveLength(2);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    expect(subscriptions).toHaveLength(1);
    expect(
      await prisma.planPurchase.count({
        where: {
          id: { in: [firstId, secondId] },
          status: PlanPurchaseStatus.COMPLETED,
        },
      }),
    ).toBe(1);
  });

  async function createReportedPurchase(
    key: string,
    targetVersionId = planVersionId,
  ): Promise<number> {
    const purchase = await prisma.planPurchase.create({
      data: {
        userId,
        planVersionId: targetVersionId,
        amountVnd: 99000,
        currency: 'VND',
        durationDays: 30,
        idempotencyKey: `${key}-${Date.now()}-${Math.random()}`,
        payment: {
          create: {
            amountVnd: 99000,
            currency: 'VND',
            transferCode: `BT-TEST-${Date.now()}-${Math.random()}`,
            status: PlanPaymentStatus.REPORTED,
            reportedAt: new Date(),
          },
        },
      },
    });
    purchaseIds.push(purchase.id);
    return purchase.id;
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
