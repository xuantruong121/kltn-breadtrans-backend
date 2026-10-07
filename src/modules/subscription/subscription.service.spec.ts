import {
  EntitlementPeriod,
  EntitlementUnit,
  PlanFeatureKey,
  PlanStatus,
  PlanVersionStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { SubscriptionService } from './subscription.service';

describe('SubscriptionService', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const freeVersion = (version = 1) => ({
    id: 10 + version,
    planId: 1,
    version,
    displayName: `Free ${version}`,
    description: null,
    durationDays: null,
    priceVnd: null,
    currency: 'VND',
    status: PlanVersionStatus.PUBLISHED,
    isCurrent: true,
    effectiveFrom: null,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    plan: {
      id: 1,
      code: 'FREE',
      displayName: 'Miễn phí',
      description: 'Free plan',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
    entitlements: [],
  });
  const paidVersion = (version = 1) => ({
    ...freeVersion(version),
    id: 20 + version,
    planId: 2,
    displayName: `Pro ${version}`,
    plan: {
      ...freeVersion(version).plan,
      id: 2,
      code: 'PRO',
      displayName: 'Pro',
    },
    entitlements: [
      {
        id: 1,
        planVersionId: 20 + version,
        featureKey: PlanFeatureKey.AI_TUTOR_MESSAGE,
        enabled: true,
        limitValue: 10,
        unit: 'REQUEST_COUNT',
        period: 'CALENDAR_MONTH',
        scope: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  const makePrisma = () => ({
    subscription: { findMany: jest.fn(), count: jest.fn() },
    planPurchase: { count: jest.fn() },
    planVersion: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  });

  it('falls back to the published FREE version when no subscription is active', async () => {
    const prisma = makePrisma();
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.planVersion.findMany.mockResolvedValue([freeVersion()]);

    const result = await new SubscriptionService(
      prisma as never,
    ).resolveEffectivePlan(7, now);

    expect(result.plan.code).toBe('FREE');
    expect(result.isPaid).toBe(false);
    expect(result.subscription).toBeNull();
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 7,
          status: SubscriptionStatus.ACTIVE,
          startsAt: { lte: now },
          endsAt: { gt: now },
        }),
      }),
    );
  });

  it('resolves an active paid subscription and its snapshot version', async () => {
    const prisma = makePrisma();
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 99,
        startsAt: new Date('2026-10-01T00:00:00.000Z'),
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
        status: SubscriptionStatus.ACTIVE,
        planVersion: paidVersion(3),
      },
    ]);

    const result = await new SubscriptionService(
      prisma as never,
    ).resolveEffectivePlan(7, now);

    expect(result.plan.code).toBe('PRO');
    expect(result.planVersion.version).toBe(3);
    expect(result.isPaid).toBe(true);
    expect(result.subscription?.id).toBe(99);
    expect(result.entitlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          featureKey: PlanFeatureKey.AI_TUTOR_MESSAGE,
          enabled: true,
          limitValue: 10,
        }),
      ]),
    );
  });

  it('excludes expired, future, and revoked subscriptions via the active-window query', async () => {
    const prisma = makePrisma();
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.planVersion.findMany.mockResolvedValue([freeVersion()]);

    const result = await new SubscriptionService(
      prisma as never,
    ).resolveEffectivePlan(7, now);

    expect(result.plan.code).toBe('FREE');
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: SubscriptionStatus.ACTIVE,
          startsAt: { lte: now },
          endsAt: { gt: now },
        }),
      }),
    );
  });

  it('rejects overlapping active subscriptions instead of choosing arbitrarily', async () => {
    const prisma = makePrisma();
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 1,
        planVersion: paidVersion(1),
      },
      {
        id: 2,
        planVersion: paidVersion(2),
      },
    ]);

    await expect(
      new SubscriptionService(prisma as never).resolveEffectivePlan(7, now),
    ).rejects.toThrow('Multiple active subscriptions overlap');
  });

  it('returns a disabled entitlement when the plan does not declare a feature', async () => {
    const prisma = makePrisma();
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.planVersion.findMany.mockResolvedValue([freeVersion()]);

    const result = await new SubscriptionService(
      prisma as never,
    ).resolveEntitlement(7, PlanFeatureKey.AI_EXPLANATION, now);

    expect(result).toMatchObject({
      featureKey: PlanFeatureKey.AI_EXPLANATION,
      enabled: false,
      limitValue: null,
    });
  });

  it('rejects an unknown feature key at the runtime boundary', async () => {
    const prisma = makePrisma();
    const service = new SubscriptionService(prisma as never);

    await expect(
      service.resolveEntitlement(7, 'UNKNOWN' as PlanFeatureKey, now),
    ).rejects.toThrow('Unknown plan feature key');
  });

  it('fails closed when the FREE catalog is missing', async () => {
    const prisma = makePrisma();
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.planVersion.findMany.mockResolvedValue([]);

    await expect(
      new SubscriptionService(prisma as never).resolveEffectivePlan(7, now),
    ).rejects.toThrow('FREE plan catalog is not configured');
  });

  it('fails closed when more than one current FREE version is returned', async () => {
    const prisma = makePrisma();
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.planVersion.findMany.mockResolvedValue([
      freeVersion(1),
      freeVersion(2),
    ]);

    await expect(
      new SubscriptionService(prisma as never).resolveEffectivePlan(7, now),
    ).rejects.toThrow('FREE plan catalog is ambiguous');
  });

  it('normalizes and validates entitlement metadata', () => {
    const service = new SubscriptionService({} as never);

    expect(() =>
      service.validatePlanEntitlementInput({
        enabled: false,
        limitValue: 10,
        unit: EntitlementUnit.REQUEST_COUNT,
        period: EntitlementPeriod.DAY,
      }),
    ).toThrow('Disabled entitlements');
    expect(() =>
      service.validatePlanEntitlementInput({
        enabled: true,
        limitValue: 10,
        unit: EntitlementUnit.CONTENT_ACCESS,
        period: EntitlementPeriod.LIFETIME,
      }),
    ).toThrow('CONTENT_ACCESS');
    expect(() =>
      service.validatePlanEntitlementInput({
        enabled: true,
        limitValue: 0,
        unit: EntitlementUnit.REQUEST_COUNT,
        period: EntitlementPeriod.DAY,
      }),
    ).toThrow('greater than zero');
    expect(() =>
      service.validatePlanEntitlementInput({
        enabled: true,
        limitValue: 10,
        unit: EntitlementUnit.REQUEST_COUNT,
        period: EntitlementPeriod.DAY,
      }),
    ).not.toThrow();
  });

  it('rejects invalid subscription dates, FREE, DRAFT, and overlapping versions', async () => {
    const prisma = makePrisma();
    prisma.planVersion = { findUnique: jest.fn() } as never;
    const service = new SubscriptionService(prisma as never);
    const invalidDates = {
      userId: 7,
      planVersionId: 1,
      startsAt: now,
      endsAt: now,
    };

    await expect(
      service.validateSubscriptionInput(invalidDates),
    ).rejects.toThrow('endsAt must be after startsAt');

    const version = {
      ...paidVersion(1),
      status: PlanVersionStatus.PUBLISHED,
      isCurrent: true,
      plan: { ...paidVersion(1).plan, status: PlanStatus.ACTIVE },
    };
    prisma.planVersion.findUnique.mockResolvedValue({
      ...version,
      plan: { ...version.plan, code: 'FREE' },
    });
    await expect(
      service.validateSubscriptionInput({
        userId: 7,
        planVersionId: 1,
        startsAt: now,
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('cannot target the FREE plan');

    prisma.planVersion.findUnique.mockResolvedValue({
      ...version,
      status: PlanVersionStatus.DRAFT,
    });
    await expect(
      service.validateSubscriptionInput({
        userId: 7,
        planVersionId: 1,
        startsAt: now,
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('current published PlanVersion');

    prisma.planVersion.findUnique.mockResolvedValue(version);
    prisma.subscription.count.mockResolvedValue(1);
    await expect(
      service.validateSubscriptionInput({
        userId: 7,
        planVersionId: 1,
        startsAt: now,
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('overlaps an existing active subscription');

    prisma.subscription.count.mockResolvedValue(0);
    await expect(
      service.validateSubscriptionInput({
        userId: 7,
        planVersionId: 1,
        startsAt: now,
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ).resolves.toEqual(version);
  });

  it('blocks mutation of a version referenced by a purchase or subscription', async () => {
    const prisma = makePrisma();
    prisma.planPurchase.count = jest.fn().mockResolvedValue(1);
    const service = new SubscriptionService(prisma as never);

    await expect(service.assertPlanVersionMutable(3)).rejects.toThrow(
      'PlanVersion referenced by a PlanPurchase or Subscription is immutable',
    );
    await expect(service.assertPlanEntitlementMutable(3)).rejects.toThrow(
      'PlanVersion referenced by a PlanPurchase or Subscription is immutable',
    );
  });
});
