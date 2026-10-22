import { ConflictException } from '@nestjs/common';
import {
  PlanStatus,
  PlanVersionStatus,
  Role,
  SubscriptionEventType,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionAdminService } from './subscription-admin.service';

describe('SubscriptionAdminService PostgreSQL Concurrency & Idempotency', () => {
  let prisma: PrismaService;
  let service: SubscriptionAdminService;
  let adminUserId: number;
  let studentUserId: number;
  let planId: number;
  let planVersionId: number;
  const createdSubscriptionIds: number[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new SubscriptionAdminService(prisma);

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    const admin = await prisma.user.create({
      data: {
        email: `admin_concurrency_${suffix}@breadtrans.local`,
        role: Role.ADMIN,
      },
    });
    adminUserId = admin.id;

    const student = await prisma.user.create({
      data: {
        email: `student_concurrency_${suffix}@breadtrans.local`,
        role: Role.STUDENT,
      },
    });
    studentUserId = student.id;

    const plan = await prisma.plan.create({
      data: {
        code: `PRO_CONC_${suffix}`,
        displayName: 'Pro Concurrency Plan',
        status: PlanStatus.ACTIVE,
      },
    });
    planId = plan.id;

    const version = await prisma.planVersion.create({
      data: {
        planId,
        version: 1,
        displayName: 'Pro Concurrency Version',
        durationDays: 30,
        priceVnd: 199000,
        currency: 'VND',
        status: PlanVersionStatus.PUBLISHED,
        isCurrent: true,
        effectiveFrom: new Date(),
        publishedAt: new Date(),
      },
    });
    planVersionId = version.id;
  });

  afterEach(async () => {
    if (createdSubscriptionIds.length > 0) {
      await prisma.subscriptionEvent.deleteMany({
        where: { subscriptionId: { in: createdSubscriptionIds } },
      });
      await prisma.subscription.deleteMany({
        where: { id: { in: createdSubscriptionIds } },
      });
      createdSubscriptionIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.planVersion.delete({ where: { id: planVersionId } });
    await prisma.plan.delete({ where: { id: planId } });
    await prisma.user.delete({ where: { id: studentUserId } });
    await prisma.user.delete({ where: { id: adminUserId } });
    await prisma.$disconnect();
  });

  it('blocks overlapping active subscriptions under concurrent grants (ACTIVE_SUBSCRIPTION_OVERLAP_BLOCKED=true)', async () => {
    const outcomes = await Promise.allSettled([
      service.grantSubscription(adminUserId, {
        studentId: studentUserId,
        planVersionId,
        durationDays: 30,
        reason: 'Concurrent Grant A',
      }),
      service.grantSubscription(adminUserId, {
        studentId: studentUserId,
        planVersionId,
        durationDays: 30,
        reason: 'Concurrent Grant B',
      }),
    ]);

    const fulfilled = outcomes.filter(
      (o): o is PromiseFulfilledResult<any> => o.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );

    // Exactly one grant must succeed, and one must be rejected with ConflictException
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason.message).toContain(
      'Học viên đang có gói hoạt động. Bạn có thể sử dụng chức năng Gia hạn.',
    );

    createdSubscriptionIds.push(fulfilled[0].value.id);

    // Verify DB state: exactly 1 active subscription
    const subsInDb = await prisma.subscription.findMany({
      where: {
        userId: studentUserId,
        status: SubscriptionStatus.ACTIVE,
      },
    });
    expect(subsInDb).toHaveLength(1);
    expect(subsInDb[0].planPurchaseId).toBeNull(); // Hard gate: no fake payment
  });

  it('guarantees idempotency on Admin Grant with duplicate client operation key (ADMIN_PRO_ACTION_IDEMPOTENCY_PASS=true)', async () => {
    const key = `idemp-grant-${Date.now()}`;
    const first = await service.grantSubscription(adminUserId, {
      studentId: studentUserId,
      planVersionId,
      durationDays: 30,
      reason: 'First Grant Attempt',
      idempotencyKey: key,
    });
    createdSubscriptionIds.push(first.id);

    const second = await service.grantSubscription(adminUserId, {
      studentId: studentUserId,
      planVersionId,
      durationDays: 30,
      reason: 'Retry with same idempotency key',
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    expect(second.endsAt).toEqual(first.endsAt);

    // Verify exactly 1 event created for this key
    const events = await prisma.subscriptionEvent.findMany({
      where: { idempotencyKey: key },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(SubscriptionEventType.ADMIN_GRANTED);
  });

  it('guarantees idempotency on Admin Extend with duplicate client operation key', async () => {
    const grant = await service.grantSubscription(adminUserId, {
      studentId: studentUserId,
      planVersionId,
      durationDays: 30,
      reason: 'Setup active subscription for extend',
    });
    createdSubscriptionIds.push(grant.id);

    const extendKey = `idemp-extend-${Date.now()}`;
    const firstExtend = await service.extendSubscription(
      adminUserId,
      grant.id,
      {
        extensionDays: 15,
        reason: 'First extend attempt',
        idempotencyKey: extendKey,
      },
    );

    const secondExtend = await service.extendSubscription(
      adminUserId,
      grant.id,
      {
        extensionDays: 15,
        reason: 'Retry extend with same key',
        idempotencyKey: extendKey,
      },
    );

    expect(secondExtend.id).toBe(firstExtend.id);
    expect(secondExtend.endsAt).toEqual(firstExtend.endsAt);

    const events = await prisma.subscriptionEvent.findMany({
      where: { idempotencyKey: extendKey },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(SubscriptionEventType.ADMIN_EXTENDED);
  });
});
