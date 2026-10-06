import {
  EntitlementPeriod,
  EntitlementUnit,
  PlanFeatureKey,
  PlanStatus,
  PlanVersionStatus,
} from '@prisma/client';
import { PlanCatalogAdminService } from './plan-catalog-admin.service';
import { SubscriptionService } from './subscription.service';

describe('PlanCatalogAdminService', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');

  const plan = {
    id: 2,
    code: 'PLUS',
    displayName: 'Plus',
    description: null,
    status: PlanStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };

  const draft = (overrides: Record<string, unknown> = {}) => ({
    id: 22,
    planId: plan.id,
    version: 1,
    displayName: 'Plus v1',
    description: null,
    durationDays: 30,
    priceVnd: 99000,
    currency: 'VND',
    status: PlanVersionStatus.DRAFT,
    isCurrent: false,
    effectiveFrom: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    plan,
    entitlements: [],
    ...overrides,
  });

  const makePrisma = () => ({
    plan: { findUnique: jest.fn() },
    planVersion: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    planEntitlement: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    subscription: { count: jest.fn() },
    planPurchase: { count: jest.fn() },
    $transaction: jest.fn(),
  });

  it('requires ADMIN at the controller boundary and creates a numbered DRAFT', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: jest.fn(),
      planVersion: {
        findFirst: jest.fn().mockResolvedValue({ version: 3 }),
        create: jest.fn().mockResolvedValue(draft({ version: 4, id: 24 })),
      },
    };
    prisma.plan.findUnique.mockResolvedValue(plan);
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    const result = await service.createDraft(
      'plus',
      { priceVnd: 120000, durationDays: 30 },
      7,
    );

    expect(result.status).toBe(PlanVersionStatus.DRAFT);
    expect(result.version).toBe(4);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.planVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 4, isCurrent: false }),
      }),
    );
  });

  it('protects FREE and rejects invalid entitlement combinations', async () => {
    const prisma = makePrisma();
    prisma.plan.findUnique.mockResolvedValue({ ...plan, code: 'FREE' });
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );
    await expect(service.createDraft('FREE', {}, 7)).rejects.toThrow(
      'FREE plan catalog is protected',
    );

    const subscription = new SubscriptionService(prisma as never);
    expect(() =>
      subscription.validatePlanEntitlementInput({
        enabled: true,
        limitValue: 10,
        unit: EntitlementUnit.CONTENT_ACCESS,
        period: EntitlementPeriod.DAY,
      }),
    ).toThrow();
  });

  it('publishes atomically, demotes the old current version and keeps history', async () => {
    const prisma = makePrisma();
    const published = draft({
      status: PlanVersionStatus.PUBLISHED,
      isCurrent: true,
      effectiveFrom: now,
      publishedAt: now,
    });
    const tx = {
      $queryRaw: jest.fn(),
      planVersion: {
        findUnique: jest.fn().mockResolvedValue(draft()),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue(published),
      },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    const result = await service.publish(22, 7);

    expect(result.isCurrent).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.planVersion.updateMany).toHaveBeenCalledWith({
      where: { planId: plan.id, isCurrent: true, id: { not: 22 } },
      data: { isCurrent: false, status: PlanVersionStatus.RETIRED },
    });
    expect(tx.planVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 22 },
        data: expect.objectContaining({
          status: PlanVersionStatus.PUBLISHED,
          isCurrent: true,
        }),
      }),
    );
  });

  it('rejects an incomplete DRAFT before changing the current version', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: jest.fn(),
      planVersion: {
        findUnique: jest.fn().mockResolvedValue(draft({ priceVnd: null })),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(((
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)) as never);
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(service.publish(22, 7)).rejects.toThrow(
      'Published paid versions require a positive priceVnd',
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.planVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.planVersion.update).not.toHaveBeenCalled();
  });

  it('rejects a draft from the reusable purchasability guard', async () => {
    const prisma = makePrisma();
    prisma.planVersion.findUnique.mockResolvedValue(draft());
    const service = new SubscriptionService(prisma as never);
    await expect(service.assertPurchasablePlanVersion(22)).rejects.toThrow(
      'Only the current published PlanVersion is purchasable',
    );
  });

  it('does not permit entitlement edits after a subscription references the version', async () => {
    const prisma = makePrisma();
    prisma.planVersion.findUnique.mockResolvedValue(draft());
    prisma.subscription.count.mockResolvedValue(1);
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );
    await expect(
      service.createEntitlement(
        22,
        {
          featureKey: PlanFeatureKey.AI_TUTOR_MESSAGE,
          enabled: true,
        },
        7,
      ),
    ).rejects.toThrow(
      'A PlanVersion referenced by a PlanPurchase or Subscription is immutable',
    );
  });
});
