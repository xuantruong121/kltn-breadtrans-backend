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

  it('starts a draft from what the current version grants', async () => {
    const prisma = makePrisma();
    const entitlement = {
      featureKey: 'PREMIUM_LISTENING',
      enabled: true,
      limitValue: null,
      unit: 'CONTENT_ACCESS',
      period: 'BILLING_CYCLE',
      scope: null,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      planVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ version: 3 })
          .mockResolvedValueOnce({
            displayName: 'Plus',
            description: 'Gói Plus',
            entitlements: [{ id: 9, planVersionId: 1, ...entitlement }],
          }),
        create: jest.fn().mockResolvedValue(draft({ version: 4 })),
      },
    };
    prisma.plan.findUnique.mockResolvedValue(plan);
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await service.createDraft('plus', { priceVnd: 79000, durationDays: 30 }, 7);

    expect(tx.planVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: 'Plus',
          description: 'Gói Plus',
          entitlements: {
            create: [
              expect.objectContaining({
                ...entitlement,
                scope: expect.anything(),
              }),
            ],
          },
        }),
      }),
    );
  });

  it('an edit landing after the draft was published is refused, not written into the live version (audit A10)', async () => {
    const prisma = makePrisma();
    prisma.planVersion.findUnique.mockResolvedValue(draft());
    prisma.subscription.count.mockResolvedValue(0);
    prisma.planPurchase.count.mockResolvedValue(0);
    // Published between the read above and the write.
    prisma.planVersion.updateMany.mockResolvedValue({ count: 0 });
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(
      service.updateDraft(22, { priceVnd: 1000 }, 7),
    ).rejects.toThrow('vừa được áp dụng');
    expect(prisma.planVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 22, status: PlanVersionStatus.DRAFT, isCurrent: false },
      }),
    );
    expect(prisma.planVersion.update).not.toHaveBeenCalled();
  });

  it('refuses to publish a paid version that grants nothing', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      planVersion: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            draft({ entitlements: [], priceVnd: 79000, durationDays: 30 }),
          ),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await expect(service.publish(1, 7)).rejects.toThrow('quyền lợi');
    expect(tx.planVersion.update).not.toHaveBeenCalled();
  });

  it('protects FREE and rejects invalid entitlement combinations', async () => {
    const prisma = makePrisma();
    prisma.plan.findUnique.mockResolvedValue({ ...plan, code: 'FREE' });
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );
    await expect(service.createDraft('FREE', {}, 7)).rejects.toThrow(
      'Gói Free được bảo vệ, không thể thay đổi.',
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
        findUnique: jest.fn().mockResolvedValue(
          draft({
            entitlements: [
              {
                featureKey: 'PREMIUM_LISTENING',
                enabled: true,
                limitValue: null,
                unit: 'CONTENT_ACCESS',
                period: null,
              },
            ],
          }),
        ),
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
    // The plan, then the version, locked before the version is read (A10).
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.planVersion.findUnique.mock.invocationCallOrder[1],
    );
    expect(tx.planVersion.updateMany).toHaveBeenCalledWith({
      where: {
        planId: plan.id,
        durationDays: 30,
        isCurrent: true,
        id: { not: 22 },
      },
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
      'Phiên bản trả phí khi xuất bản phải có giá lớn hơn 0.',
    );
    // The locks come before the validation now (audit A10); nothing is written.
    expect(tx.planVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.planVersion.update).not.toHaveBeenCalled();
  });

  it('a draft of a term starts from the version of that term, not from any current one', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      planVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ version: 4 })
          .mockResolvedValueOnce({
            displayName: 'BreadTrans Plus — 180 ngày',
            description: 'Thời hạn 180 ngày',
            entitlements: [],
          }),
        create: jest.fn().mockResolvedValue(draft({ version: 5 })),
      },
    };
    prisma.plan.findUnique.mockResolvedValue(plan);
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const service = new PlanCatalogAdminService(
      prisma as never,
      new SubscriptionService(prisma as never),
    );

    await service.createDraft(
      'plus',
      { priceVnd: 350000, durationDays: 180 },
      7,
    );

    expect(tx.planVersion.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { planId: plan.id, isCurrent: true, durationDays: 180 },
      }),
    );
    expect(tx.planVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: 'BreadTrans Plus — 180 ngày',
          durationDays: 180,
        }),
      }),
    );
  });

  describe('changePrice (owner 2026-11-28)', () => {
    const entitlement = {
      id: 9,
      planVersionId: 103,
      featureKey: 'PREMIUM_LISTENING',
      enabled: true,
      limitValue: null,
      unit: 'CONTENT_ACCESS',
      period: null,
      scope: null,
    };
    const selling = (overrides: Record<string, unknown> = {}) =>
      draft({
        id: 103,
        version: 4,
        displayName: 'BreadTrans Plus — 180 ngày',
        description: 'Thời hạn 180 ngày',
        durationDays: 180,
        priceVnd: 331000,
        status: PlanVersionStatus.PUBLISHED,
        isCurrent: true,
        entitlements: [entitlement],
        ...overrides,
      });
    const setup = (
      current: unknown = selling(),
      planRow: Record<string, unknown> = plan,
    ) => {
      const prisma = makePrisma();
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        planVersion: {
          findFirst: jest.fn().mockResolvedValue(current),
          aggregate: jest.fn().mockResolvedValue({ _max: { version: 5 } }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve(
              draft({
                ...data,
                id: 108,
                entitlements: [entitlement],
              }),
            ),
          ),
        },
      };
      prisma.plan.findUnique.mockResolvedValue(planRow);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      const service = new PlanCatalogAdminService(
        prisma as never,
        new SubscriptionService(prisma as never),
      );
      return { service, tx, prisma };
    };

    it('puts a new version of the same term on sale and retires only that term', async () => {
      const { service, tx } = setup();

      const result = await service.changePrice('plus', 180, 350000, 7);

      expect(result.priceVnd).toBe(350000);
      expect(result.version).toBe(6);
      expect(result.isCurrent).toBe(true);
      expect(tx.planVersion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            planId: plan.id,
            durationDays: 180,
            isCurrent: true,
            status: PlanVersionStatus.PUBLISHED,
          },
        }),
      );
      // The old version of that term only; the 30 and 90 day terms stay on sale.
      expect(tx.planVersion.updateMany).toHaveBeenCalledWith({
        where: { planId: plan.id, durationDays: 180, isCurrent: true },
        data: { isCurrent: false, status: PlanVersionStatus.RETIRED },
      });
      expect(tx.planVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 6,
            durationDays: 180,
            priceVnd: 350000,
            displayName: 'BreadTrans Plus — 180 ngày',
            description: 'Thời hạn 180 ngày',
            status: PlanVersionStatus.PUBLISHED,
            isCurrent: true,
            entitlements: {
              create: [
                expect.objectContaining({
                  featureKey: 'PREMIUM_LISTENING',
                  enabled: true,
                  unit: 'CONTENT_ACCESS',
                }),
              ],
            },
          }),
        }),
      );
    });

    it('locks the plan first, retires the old version before the new one is created', async () => {
      const { service, tx } = setup();
      await service.changePrice('plus', 180, 350000, 7);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.planVersion.findFirst.mock.invocationCallOrder[0],
      );
      expect(
        tx.planVersion.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(tx.planVersion.create.mock.invocationCallOrder[0]);
    });

    it('refuses the price already on sale and writes nothing', async () => {
      const { service, tx } = setup();
      await expect(service.changePrice('plus', 180, 331000, 7)).rejects.toThrow(
        'trùng với giá đang bán',
      );
      expect(tx.planVersion.updateMany).not.toHaveBeenCalled();
      expect(tx.planVersion.create).not.toHaveBeenCalled();
    });

    it('refuses a term that is not on sale', async () => {
      const { service, tx } = setup(null);
      await expect(service.changePrice('plus', 365, 500000, 7)).rejects.toThrow(
        'chưa có mức 365 ngày đang bán',
      );
      expect(tx.planVersion.create).not.toHaveBeenCalled();
    });

    it('protects the FREE plan', async () => {
      const { service, tx } = setup(selling(), { ...plan, code: 'FREE' });
      await expect(service.changePrice('FREE', 180, 1000, 7)).rejects.toThrow(
        'Gói Free được bảo vệ',
      );
      expect(tx.planVersion.create).not.toHaveBeenCalled();
    });

    it('does not lose what the plan grants: a term with no grants is refused', async () => {
      const { service, tx } = setup(selling({ entitlements: [] }));
      await expect(service.changePrice('plus', 180, 350000, 7)).rejects.toThrow(
        'chưa có quyền lợi',
      );
      expect(tx.planVersion.updateMany).not.toHaveBeenCalled();
      expect(tx.planVersion.create).not.toHaveBeenCalled();
    });

    it('refuses a price of zero or a fraction before anything is written', async () => {
      const zero = setup();
      await expect(zero.service.changePrice('plus', 180, 0, 7)).rejects.toThrow(
        'lớn hơn 0',
      );
      expect(zero.tx.planVersion.create).not.toHaveBeenCalled();

      const fraction = setup();
      await expect(
        fraction.service.changePrice('plus', 180, 1000.5, 7),
      ).rejects.toThrow('số nguyên');
      expect(fraction.tx.planVersion.updateMany).not.toHaveBeenCalled();
    });
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
      'Phiên bản gói đã có giao dịch hoặc đăng ký nên không thể sửa.',
    );
  });
});
