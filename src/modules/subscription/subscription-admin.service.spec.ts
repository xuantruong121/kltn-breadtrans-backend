import { ConflictException } from '@nestjs/common';
import {
  PlanFeatureKey,
  PlanStatus,
  PlanVersionStatus,
  Role,
  SubscriptionEventType,
  SubscriptionStatus,
} from '@prisma/client';
import { SubscriptionAdminService } from './subscription-admin.service';
import { SubscriptionService } from './subscription.service';

describe('SubscriptionAdminService', () => {
  let service: SubscriptionAdminService;
  let subscriptionService: SubscriptionService;
  let prismaMock: any;

  const now = new Date('2026-10-22T10:00:00.000Z');
  const adminId = 1;
  const studentId = 10;

  const mockPlan = {
    id: 1,
    code: 'PLUS',
    displayName: 'Gói Plus',
    status: PlanStatus.ACTIVE,
  };

  const mockPlanVersion = {
    id: 101,
    planId: 1,
    version: 1,
    displayName: 'Plus 30 ngày',
    durationDays: 30,
    priceVnd: 99000,
    currency: 'VND',
    status: PlanVersionStatus.PUBLISHED,
    isCurrent: true,
    plan: mockPlan,
    entitlements: [
      {
        featureKey: PlanFeatureKey.PREMIUM_READING,
        enabled: true,
        limitValue: null,
        unit: null,
        period: null,
        scope: null,
      },
    ],
  };

  const mockStudent = {
    id: studentId,
    email: 'student@example.com',
    role: Role.STUDENT,
    profile: {
      id: 5,
      userId: studentId,
      fullName: 'Nguyễn Văn Học',
    },
  };

  beforeEach(() => {
    prismaMock = {
      subscription: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      subscriptionEvent: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      planVersion: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prismaMock)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: studentId }]),
    };

    service = new SubscriptionAdminService(prismaMock);
    subscriptionService = new SubscriptionService(prismaMock);
  });

  describe('listSubscriptions', () => {
    it('returns formatted list of subscriptions with product-friendly statuses and sources', async () => {
      const activeEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      prismaMock.subscription.count.mockResolvedValue(2);
      prismaMock.subscription.findMany.mockResolvedValue([
        {
          id: 1,
          userId: studentId,
          planVersionId: 101,
          planPurchaseId: 55, // paid
          status: SubscriptionStatus.ACTIVE,
          startsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          endsAt: activeEndsAt,
          createdAt: new Date(),
          user: mockStudent,
          planVersion: mockPlanVersion,
        },
        {
          id: 2,
          userId: studentId,
          planVersionId: 101,
          planPurchaseId: null, // admin granted
          status: SubscriptionStatus.REVOKED,
          startsAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          endsAt: activeEndsAt,
          createdAt: new Date(),
          user: mockStudent,
          planVersion: mockPlanVersion,
        },
      ]);

      const result = await service.listSubscriptions({ status: 'ALL' });

      expect(result.total).toBe(2);
      expect(result.items[0].source).toBe('PAYMENT');
      expect(result.items[0].sourceLabel).toBe('Thanh toán');
      expect(result.items[0].status).toBe('ACTIVE');
      expect(result.items[0].remainingDays).toBeGreaterThan(0);

      expect(result.items[1].source).toBe('ADMIN_GRANT');
      expect(result.items[1].sourceLabel).toBe('Admin tặng');
      expect(result.items[1].status).toBe('REVOKED');
      expect(result.items[1].remainingDays).toBe(0);
    });

    it('filters expired subscriptions correctly', async () => {
      prismaMock.subscription.count.mockResolvedValue(1);
      prismaMock.subscription.findMany.mockResolvedValue([
        {
          id: 3,
          userId: studentId,
          planVersionId: 101,
          planPurchaseId: null,
          status: SubscriptionStatus.ACTIVE,
          startsAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
          endsAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // past
          createdAt: new Date(),
          user: mockStudent,
          planVersion: mockPlanVersion,
        },
      ]);

      const result = await service.listSubscriptions({ status: 'EXPIRED' });
      expect(result.items[0].status).toBe('EXPIRED');
    });
  });

  describe('grantSubscription (Admin Grant)', () => {
    it('creates Subscription with planPurchaseId = null and emits ADMIN_GRANTED event without creating payment', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockStudent);
      prismaMock.planVersion.findUnique.mockResolvedValue(mockPlanVersion);
      prismaMock.subscription.findFirst.mockResolvedValue(null); // No active sub

      const createdSub = {
        id: 10,
        userId: studentId,
        planVersionId: 101,
        planPurchaseId: null,
        status: SubscriptionStatus.ACTIVE,
        startsAt: now,
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        createdAt: now,
        user: mockStudent,
        planVersion: mockPlanVersion,
      };
      prismaMock.subscription.create.mockResolvedValue(createdSub);
      prismaMock.subscription.findUniqueOrThrow.mockResolvedValue(createdSub);

      const result = await service.grantSubscription(adminId, {
        studentId,
        planVersionId: 101,
        durationDays: 30,
        reason: 'Học sinh xuất sắc kỳ thi',
        idempotencyKey: 'grant-test-1',
      });

      expect(prismaMock.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: studentId,
          planVersionId: 101,
          planPurchaseId: null, // Hard gate: no payment created!
          status: SubscriptionStatus.ACTIVE,
        }),
      });

      expect(prismaMock.subscriptionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 10,
          type: SubscriptionEventType.ADMIN_GRANTED,
          actorUserId: adminId,
          reason: 'Học sinh xuất sắc kỳ thi',
          idempotencyKey: 'grant-test-1',
        }),
      });

      expect(result.source).toBe('ADMIN_GRANT');
      expect(result.sourceLabel).toBe('Admin tặng');
      expect(result.planPurchaseId).toBeNull();
    });

    it('rejects grant if learner already has an active subscription with required message', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockStudent);
      prismaMock.planVersion.findUnique.mockResolvedValue(mockPlanVersion);
      prismaMock.subscription.findFirst.mockResolvedValue({
        id: 5,
        status: SubscriptionStatus.ACTIVE,
        endsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });

      await expect(
        service.grantSubscription(adminId, {
          studentId,
          planVersionId: 101,
          reason: 'Tặng thêm',
        }),
      ).rejects.toThrow(
        new ConflictException(
          'Học viên đang có gói hoạt động. Bạn có thể sử dụng chức năng Gia hạn.',
        ),
      );

      expect(prismaMock.subscription.create).not.toHaveBeenCalled();
    });

    it('is idempotent when same idempotencyKey is sent again', async () => {
      const existingSub = {
        id: 10,
        userId: studentId,
        planVersionId: 101,
        planPurchaseId: null,
        status: SubscriptionStatus.ACTIVE,
        startsAt: now,
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        createdAt: now,
        user: mockStudent,
        planVersion: mockPlanVersion,
      };

      prismaMock.subscriptionEvent.findUnique.mockResolvedValue({
        id: 1,
        type: SubscriptionEventType.ADMIN_GRANTED,
        idempotencyKey: 'idemp-grant-repeat',
        subscription: existingSub,
      });

      const result = await service.grantSubscription(adminId, {
        studentId,
        planVersionId: 101,
        reason: 'Lần thử 2',
        idempotencyKey: 'idemp-grant-repeat',
      });

      expect(result.id).toBe(10);
      expect(prismaMock.subscription.create).not.toHaveBeenCalled();
    });
  });

  describe('extendSubscription (Admin Extend)', () => {
    it('preserves remaining time: newEndsAt = oldEndsAt + extensionDays when endsAt > now', async () => {
      const currentEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const sub = {
        id: 15,
        userId: studentId,
        planVersionId: 101,
        planPurchaseId: 44,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        endsAt: currentEndsAt,
        user: mockStudent,
        planVersion: mockPlanVersion,
      };

      prismaMock.subscription.findUnique.mockResolvedValue(sub);
      prismaMock.subscription.findUniqueOrThrow.mockResolvedValue(sub);

      let savedEndsAt: Date | undefined;
      prismaMock.subscription.update.mockImplementation(
        ({ data }: { data: { endsAt: Date } }) => {
          savedEndsAt = data.endsAt;
          return Promise.resolve({
            ...sub,
            endsAt: data.endsAt,
          });
        },
      );

      await service.extendSubscription(adminId, 15, {
        extensionDays: 30,
        reason: 'Học viên gia hạn đặc cách',
        idempotencyKey: 'extend-idemp-1',
      });

      expect(savedEndsAt).toBeDefined();
      const diffMs = savedEndsAt!.getTime() - currentEndsAt.getTime();
      const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(30);

      expect(prismaMock.subscriptionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 15,
          type: SubscriptionEventType.ADMIN_EXTENDED,
          actorUserId: adminId,
          reason: 'Học viên gia hạn đặc cách',
          previousEndsAt: currentEndsAt,
          idempotencyKey: 'extend-idemp-1',
        }),
      });
    });

    it('rejects extension if subscription is expired or revoked', async () => {
      const expiredSub = {
        id: 16,
        userId: studentId,
        planVersionId: 101,
        status: SubscriptionStatus.ACTIVE,
        endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // past
        user: mockStudent,
        planVersion: mockPlanVersion,
      };
      prismaMock.subscription.findUnique.mockResolvedValue(expiredSub);
      prismaMock.subscription.findUniqueOrThrow.mockResolvedValue(expiredSub);

      await expect(
        service.extendSubscription(adminId, 16, {
          extensionDays: 15,
          reason: 'Gia hạn gói cũ',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('revokeSubscription (Admin Revoke)', () => {
    it('sets status = REVOKED and creates ADMIN_REVOKED event without deleting record', async () => {
      const currentEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      const sub = {
        id: 20,
        userId: studentId,
        planVersionId: 101,
        planPurchaseId: null,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        endsAt: currentEndsAt,
        user: mockStudent,
        planVersion: mockPlanVersion,
      };

      prismaMock.subscription.findUnique.mockResolvedValue(sub);
      prismaMock.subscription.findUniqueOrThrow.mockResolvedValue(sub);
      prismaMock.subscription.update.mockResolvedValue({
        ...sub,
        status: SubscriptionStatus.REVOKED,
      });

      const result = await service.revokeSubscription(adminId, 20, {
        reason: 'Vi phạm điều khoản cộng đồng',
        idempotencyKey: 'revoke-1',
      });

      expect(prismaMock.subscription.update).toHaveBeenCalledWith({
        where: { id: 20 },
        data: { status: SubscriptionStatus.REVOKED },
        include: expect.any(Object),
      });

      expect(prismaMock.subscriptionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 20,
          type: SubscriptionEventType.ADMIN_REVOKED,
          actorUserId: adminId,
          reason: 'Vi phạm điều khoản cộng đồng',
          idempotencyKey: 'revoke-1',
        }),
      });

      expect(result.status).toBe('REVOKED');
    });

    it('causes SubscriptionService.hasFeature to return false once revoked', async () => {
      // Mock that prisma.subscription.findMany returns no active subscriptions because status is REVOKED
      prismaMock.subscription.findMany.mockResolvedValue([]);
      prismaMock.planVersion.findMany.mockResolvedValue([
        {
          id: 999,
          version: 1,
          displayName: 'Free',
          description: null,
          durationDays: null,
          priceVnd: 0,
          currency: 'VND',
          plan: {
            id: 99,
            code: 'FREE',
            displayName: 'Miễn phí',
            description: null,
          },
          entitlements: [
            {
              featureKey: PlanFeatureKey.PREMIUM_READING,
              enabled: false,
            },
          ],
        },
      ]);

      const hasPremium = await subscriptionService.hasFeature(
        studentId,
        PlanFeatureKey.PREMIUM_READING,
      );
      expect(hasPremium).toBe(false);
    });
  });

  describe('getSubscriptionHistory (Audit Trail)', () => {
    it('returns history events ordered newest first with human-readable type labels', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue({
        id: 30,
        planVersion: mockPlanVersion,
      });

      prismaMock.subscriptionEvent.findMany.mockResolvedValue([
        {
          id: 102,
          subscriptionId: 30,
          type: SubscriptionEventType.ADMIN_EXTENDED,
          actorUserId: adminId,
          reason: 'Học viên chăm chỉ',
          previousEndsAt: new Date('2026-11-01'),
          newEndsAt: new Date('2026-12-01'),
          metadata: { extensionDays: 30 },
          createdAt: new Date('2026-10-25'),
          actor: {
            id: adminId,
            email: 'admin@breadtrans.com',
            profile: { fullName: 'Trần Quản Trị' },
          },
        },
        {
          id: 101,
          subscriptionId: 30,
          type: SubscriptionEventType.ADMIN_GRANTED,
          actorUserId: adminId,
          reason: 'Tặng học bổng',
          previousEndsAt: null,
          newEndsAt: new Date('2026-11-01'),
          metadata: null,
          createdAt: new Date('2026-10-01'),
          actor: {
            id: adminId,
            email: 'admin@breadtrans.com',
            profile: { fullName: 'Trần Quản Trị' },
          },
        },
      ]);

      const history = await service.getSubscriptionHistory(30);

      expect(history.length).toBe(2);
      expect(history[0].typeLabel).toBe('Admin gia hạn');
      expect(history[0].actorName).toBe('Trần Quản Trị');
      expect(history[1].typeLabel).toBe('Admin tặng gói');
    });

    it('provides legacy fallback provenance when no event rows exist for historical subscription', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue({
        id: 40,
        planPurchaseId: 12,
        createdAt: new Date('2026-09-01'),
        endsAt: new Date('2026-10-01'),
        planVersion: mockPlanVersion,
      });
      prismaMock.subscriptionEvent.findMany.mockResolvedValue([]);

      const history = await service.getSubscriptionHistory(40);

      expect(history.length).toBe(1);
      expect(history[0].typeLabel).toBe('Kích hoạt qua thanh toán');
      expect(history[0].actorName).toBe('Cổng thanh toán');
    });
  });
});
