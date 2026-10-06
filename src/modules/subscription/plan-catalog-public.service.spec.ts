import { PlanStatus, PlanVersionStatus } from '@prisma/client';
import { PlanCatalogPublicService } from './plan-catalog-public.service';
import { SubscriptionService } from './subscription.service';

describe('PlanCatalogPublicService', () => {
  const now = new Date('2026-10-06T00:00:00.000Z');

  const plan = (code: string, status: PlanStatus = PlanStatus.ACTIVE) => ({
    id: code === 'FREE' ? 1 : code === 'PLUS' ? 2 : 3,
    code,
    displayName: `BreadTrans ${code}`,
    description: `${code} description`,
    status,
    createdAt: now,
    updatedAt: now,
    versions: [] as unknown[],
  });

  const version = (
    planCode: string,
    overrides: Partial<{
      id: number;
      status: PlanVersionStatus;
      isCurrent: boolean;
      priceVnd: number | null;
      durationDays: number | null;
      currency: string;
    }> = {},
  ) => ({
    id: overrides.id ?? 20,
    planId: plan(planCode).id,
    version: 1,
    displayName: `${planCode} monthly`,
    description: 'A public plan version',
    durationDays: overrides.durationDays ?? 30,
    priceVnd: overrides.priceVnd ?? 69000,
    currency: overrides.currency ?? 'VND',
    status: overrides.status ?? PlanVersionStatus.PUBLISHED,
    isCurrent: overrides.isCurrent ?? true,
    effectiveFrom: now,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    entitlements: [],
  });

  const makePrisma = () => ({ plan: { findMany: jest.fn() } });

  const makeService = () => {
    const prisma = makePrisma();
    const subscriptionService = new SubscriptionService({} as never);
    return {
      prisma,
      service: new PlanCatalogPublicService(
        prisma as never,
        subscriptionService,
      ),
    };
  };

  it('returns display-only FREE and no fabricated PLUS/PRO purchase targets', async () => {
    const { prisma, service } = makeService();
    prisma.plan.findMany.mockResolvedValue([
      plan('PRO'),
      plan('FREE'),
      plan('PLUS'),
    ]);

    const result = await service.getCatalog();

    expect(result.plans.map(({ code }) => code)).toEqual([
      'FREE',
      'PLUS',
      'PRO',
    ]);
    expect(result.plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FREE',
          purchasable: false,
          currentVersion: null,
        }),
        expect.objectContaining({
          code: 'PLUS',
          purchasable: false,
          currentVersion: null,
        }),
        expect.objectContaining({
          code: 'PRO',
          purchasable: false,
          currentVersion: null,
        }),
      ]),
    );
    expect(prisma.plan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: PlanStatus.ACTIVE },
        include: {
          versions: expect.objectContaining({
            where: {
              status: PlanVersionStatus.PUBLISHED,
              isCurrent: true,
            },
          }),
        },
      }),
    );
  });

  it('exposes exact terms and ID for a valid current published paid version', async () => {
    const { prisma, service } = makeService();
    const plus = plan('PLUS');
    plus.versions = [version('PLUS', { id: 42 })];
    prisma.plan.findMany.mockResolvedValue([plus]);

    const result = await service.getCatalog();

    expect(result).toEqual({
      plans: [
        expect.objectContaining({
          code: 'PLUS',
          purchasable: true,
          currentVersion: {
            id: 42,
            version: 1,
            displayName: 'PLUS monthly',
            description: 'A public plan version',
            priceVnd: 69000,
            currency: 'VND',
            durationDays: 30,
          },
        }),
      ],
    });
  });

  it.each([
    ['draft', { status: PlanVersionStatus.DRAFT }],
    ['retired', { status: PlanVersionStatus.RETIRED, isCurrent: false }],
    ['non-current', { isCurrent: false }],
    ['zero price', { priceVnd: 0 }],
    ['zero duration', { durationDays: 0 }],
    ['wrong currency', { currency: 'USD' }],
  ])('fails closed for %s versions', async (_label, overrides) => {
    const { prisma, service } = makeService();
    const plus = plan('PLUS');
    plus.versions = [version('PLUS', overrides)];
    prisma.plan.findMany.mockResolvedValue([plus]);

    const result = await service.getCatalog();

    expect(result.plans[0]).toEqual(
      expect.objectContaining({ purchasable: false, currentVersion: null }),
    );
  });

  it('does not choose arbitrarily when multiple current versions exist', async () => {
    const { prisma, service } = makeService();
    const plus = plan('PLUS');
    plus.versions = [version('PLUS', { id: 1 }), version('PLUS', { id: 2 })];
    prisma.plan.findMany.mockResolvedValue([plus]);

    const result = await service.getCatalog();

    expect(result.plans[0].currentVersion).toBeNull();
    expect(result.plans[0].purchasable).toBe(false);
  });

  it('omits inactive plans even if a broken data source returns one', async () => {
    const { prisma, service } = makeService();
    const inactive = plan('PLUS', PlanStatus.INACTIVE);
    inactive.versions = [version('PLUS')];
    prisma.plan.findMany.mockResolvedValue([inactive]);

    await expect(service.getCatalog()).resolves.toEqual({ plans: [] });
  });
});
