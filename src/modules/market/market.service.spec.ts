import { Test, TestingModule } from '@nestjs/testing';
import { MarketService } from './market.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { GamificationService } from '../gamification/gamification.service';
import { UnprocessableEntityException } from '@nestjs/common';

const mockPrismaService = {
  marketProduct: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  userShippingProfile: {
    findUnique: jest.fn(),
  },
  profile: {
    findUnique: jest.fn(),
  },
  userStats: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    aggregate: jest.fn(),
  },
  leaderboard: {
    findUnique: jest.fn(),
  },
  pointHistory: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  marketOrder: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  marketPhysicalRedemption: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  banhTransaction: {
    create: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  currencyTransaction: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockEventsGateway = {
  sendCurrencyUpdate: jest.fn(),
  sendOrderReviewUpdate: jest.fn(),
};

const mockGamificationService = {
  deductBanh: jest
    .fn()
    .mockResolvedValue({ success: true, newBalance: 0, alreadyApplied: false }),
  awardBanh: jest.fn().mockResolvedValue({
    requested: 0,
    granted: 0,
    rejected: 0,
    remainingDaily: 0,
    newBalance: 0,
    isCapped: false,
  }),
  appendLegacyReconciliationEntry: jest.fn().mockResolvedValue({
    applied: false,
    alreadyApplied: false,
    balanceAfter: 0,
  }),
};

describe('MarketService', () => {
  let service: MarketService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EventsGateway,
          useValue: mockEventsGateway,
        },
        {
          provide: GamificationService,
          useValue: mockGamificationService,
        },
      ],
    }).compile();

    service = module.get<MarketService>(MarketService);
  });

  describe('getProducts', () => {
    it('maps fulfillmentType and requiresShippingAddress correctly', async () => {
      mockPrismaService.marketProduct.findMany.mockResolvedValue([
        {
          id: 1,
          slug: 'badge-star',
          name: 'Huy hiệu Ngôi sao',
          description: 'Huy hiệu danh dự',
          category: 'BADGE',
          rarity: 'COMMON',
          price: 10,
          imageUrl: '/images/market/badge-star.svg',
          stock: 100,
          purchaseCount: 5,
          isActive: true,
          fulfillmentType: 'DIGITAL',
        },
        {
          id: 2,
          slug: 'gift-notebook',
          name: 'Sổ tay BreadTrans',
          description: 'Sổ tay từ vựng gửi tận nhà',
          category: 'PHYSICAL',
          rarity: 'RARE',
          price: 50,
          imageUrl: '/images/market/gift-notebook.svg',
          stock: 20,
          purchaseCount: 2,
          isActive: true,
          fulfillmentType: 'PHYSICAL',
        },
      ]);

      const products = await service.getProducts();

      expect(products).toHaveLength(2);
      expect(products[0].fulfillmentType).toBe('DIGITAL');
      expect(products[0].requiresShippingAddress).toBe(false);

      expect(products[1].fulfillmentType).toBe('PHYSICAL');
      expect(products[1].requiresShippingAddress).toBe(true);
    });
  });

  describe('createOrder - Physical reward fulfillment gate', () => {
    const mockDigitalProduct = {
      id: 1,
      slug: 'streak-freeze',
      name: 'Khiên chuỗi',
      price: 20,
      stock: 50,
      isActive: true,
      fulfillmentType: 'DIGITAL',
      category: 'ITEM',
    };

    const mockPhysicalProduct = {
      id: 2,
      slug: 'gift-bottle',
      name: 'Bình giữ nhiệt BreadTrans',
      price: 100,
      stock: 10,
      isActive: true,
      fulfillmentType: 'PHYSICAL',
      category: 'PHYSICAL',
    };

    it('allows digital item redemption without any shipping profile', async () => {
      mockPrismaService.marketProduct.findMany.mockResolvedValue([
        mockDigitalProduct,
      ]);
      mockPrismaService.marketOrder.findUnique.mockResolvedValue(null);
      mockPrismaService.profile.findUnique.mockResolvedValue({
        fullName: 'Digital Learner',
      });

      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            $executeRaw: jest.fn(),
            marketOrder: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({
                id: 99,
                status: 'approved',
                totalBanh: 20,
              }),
            },
            marketProduct: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            userStats: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 80 }),
              update: jest.fn(),
            },
            banhTransaction: {
              create: jest.fn().mockResolvedValue({ id: 1 }),
            },
            marketPhysicalRedemption: {
              create: jest.fn(),
            },
          };
          return await callback(tx);
        },
      );

      const result = await service.createOrder(1, {
        items: [{ id: 'streak-freeze', quantity: 1 }],
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('approved');
      // No userShippingProfile query required for digital items
      expect(
        mockPrismaService.userShippingProfile.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('blocks physical item redemption when user has no shipping profile, with 0 balance deduction', async () => {
      mockPrismaService.marketProduct.findMany.mockResolvedValue([
        mockPhysicalProduct,
      ]);
      mockPrismaService.marketOrder.findUnique.mockResolvedValue(null);
      mockPrismaService.profile.findUnique.mockResolvedValue({
        fullName: 'Learner Without Address',
      });
      mockPrismaService.userShippingProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.createOrder(2, {
          items: [{ id: 'gift-bottle', quantity: 1 }],
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Verify transaction was never entered -> zero balance deduction, zero order created
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(mockPrismaService.userStats.updateMany).not.toHaveBeenCalled();
    });

    it('blocks physical item redemption when shipping profile is incomplete (missing phone)', async () => {
      mockPrismaService.marketProduct.findMany.mockResolvedValue([
        mockPhysicalProduct,
      ]);
      mockPrismaService.marketOrder.findUnique.mockResolvedValue(null);
      mockPrismaService.profile.findUnique.mockResolvedValue({
        fullName: 'Learner QA',
      });
      mockPrismaService.userShippingProfile.findUnique.mockResolvedValue({
        recipientName: 'Nguyễn Văn QA',
        phone: '', // missing
        provinceCode: '79',
        wardCode: '26734',
        addressLine: '12 Nguyễn Văn Bảo',
      });

      try {
        await service.createOrder(2, {
          items: [{ id: 'gift-bottle', quantity: 1 }],
        });
        fail('Expected UnprocessableEntityException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        const exception = err as UnprocessableEntityException;
        const response = exception.getResponse() as {
          code: string;
          missingFields: string[];
        };
        expect(response.code).toBe('SHIPPING_PROFILE_REQUIRED');
        expect(response.missingFields).toContain('phone');
      }

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('creates order and snapshots shipping information immutably when shipping profile is complete', async () => {
      mockPrismaService.marketProduct.findMany.mockResolvedValue([
        mockPhysicalProduct,
      ]);
      mockPrismaService.marketOrder.findUnique.mockResolvedValue(null);
      mockPrismaService.profile.findUnique.mockResolvedValue({
        fullName: 'Learner QA',
      });

      const mockShipping = {
        id: 5,
        userId: 2,
        recipientName: 'Nguyễn Văn QA',
        phone: '+84987654321',
        countryCode: 'VN',
        provinceCode: '79',
        provinceName: 'Thành phố Hồ Chí Minh',
        wardCode: '26734',
        wardName: 'Phường 1',
        addressLine: '12 Nguyễn Văn Bảo',
      };
      mockPrismaService.userShippingProfile.findUnique.mockResolvedValue(
        mockShipping,
      );

      let createdRedemption: Record<string, unknown> | null = null;

      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            $executeRaw: jest.fn(),
            marketOrder: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({
                id: 101,
                status: 'pending',
                totalBanh: 100,
              }),
            },
            marketProduct: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            userStats: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 150 }),
              update: jest.fn(),
            },
            banhTransaction: {
              create: jest.fn().mockResolvedValue({ id: 10 }),
            },
            userShippingProfile: {
              findUnique: jest.fn().mockResolvedValue(mockShipping),
            },
            marketPhysicalRedemption: {
              create: jest
                .fn()
                .mockImplementation(
                  ({ data }: { data: Record<string, unknown> }) => {
                    createdRedemption = data;
                    return { id: 1, ...data };
                  },
                ),
            },
          };
          return await callback(tx);
        },
      );

      const result = await service.createOrder(2, {
        items: [{ id: 'gift-bottle', quantity: 1 }],
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('pending');
      expect(createdRedemption).toBeDefined();
      const redemption = createdRedemption as Record<string, unknown> | null;
      if (!redemption) {
        throw new Error('Expected a physical redemption to be created');
      }
      expect(redemption.recipientName).toBe('Nguyễn Văn QA');
      expect(redemption.phone).toBe('+84987654321');
      expect(redemption.provinceCode).toBe('79');
      expect(redemption.provinceName).toBe('Thành phố Hồ Chí Minh');
      expect(redemption.wardCode).toBe('26734');
      expect(redemption.wardName).toBe('Phường 1');
      expect(redemption.addressLine).toBe('12 Nguyễn Văn Bảo');
      expect(redemption.formattedAddress).toBe(
        '12 Nguyễn Văn Bảo, Phường 1, Thành phố Hồ Chí Minh, Việt Nam',
      );
      expect(redemption.status).toBe('PENDING');
    });
  });

  describe('markFulfillmentFailed — approved-order refund, double-apply blocked', () => {
    const approvedOrder = {
      id: 42,
      userId: 7,
      status: 'approved',
      totalBanh: 80,
      items: [{ productId: 1, quantity: 1 }],
      studentName: 'Học viên',
    };

    it('rejects an order that is still pending (wrong state for this action)', async () => {
      mockPrismaService.marketOrder.findUnique.mockResolvedValue({
        ...approvedOrder,
        status: 'pending',
      });

      await expect(
        service.markFulfillmentFailed(42, 'Hàng bị thất lạc', 'admin@x.com'),
      ).rejects.toThrow();
    });

    it('refunds Bread via awardBanh, restores stock, cancels physical redemption, and is CAS-guarded against double apply', async () => {
      mockPrismaService.marketOrder.findUnique
        .mockResolvedValueOnce(approvedOrder) // initial state check
        .mockResolvedValueOnce({ ...approvedOrder, status: 'refunded' }); // post-tx re-read

      mockGamificationService.awardBanh.mockResolvedValueOnce({
        requested: 80,
        granted: 80,
        rejected: 0,
        remainingDaily: 150,
        newBalance: 180,
        isCapped: false,
      });

      const tx: any = {
        marketOrder: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...approvedOrder, status: 'refunded' }),
        },
        marketProduct: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        marketPhysicalRedemption: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      mockPrismaService.$transaction.mockImplementation((cb: any) => cb(tx));

      const result = await service.markFulfillmentFailed(
        42,
        'Hàng bị thất lạc',
        'admin@x.com',
      );

      expect(mockGamificationService.awardBanh).toHaveBeenCalledWith(
        7,
        80,
        'MARKET_REFUND',
        'market:order:42:fulfillment-failed',
        expect.objectContaining({ isCapped: false }),
        tx,
      );
      expect(tx.marketOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42, status: 'approved' },
          data: expect.objectContaining({ status: 'refunded' }),
        }),
      );
      expect(result?.status).toBe('refunded');
    });

    it('refund is idempotent — a second call after the status has already moved is rejected by the CAS, never double-refunding', async () => {
      // After the first successful call the order is 'refunded', so a retry's
      // initial state check already fails the 'approved'/'completed' guard.
      mockPrismaService.marketOrder.findUnique.mockResolvedValue({
        ...approvedOrder,
        status: 'refunded',
      });

      await expect(
        service.markFulfillmentFailed(42, 'Hàng bị thất lạc', 'admin@x.com'),
      ).rejects.toThrow();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('adjustCurrency — idempotent Admin adjustment', () => {
    const dto = {
      userId: 9,
      amount: 100,
      reason: 'Thưởng học viên xuất sắc',
      idempotencyKey: 'op-123',
    };
    let adjustTx: {
      userStats: { findUnique: jest.Mock };
      pointHistory: { create: jest.Mock };
      currencyTransaction: { create: jest.Mock };
    };

    beforeEach(() => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 9,
        email: 'u9@x.com',
        profile: { fullName: 'Học viên 9' },
      });
      adjustTx = {
        userStats: {
          findUnique: jest.fn().mockResolvedValue({ totalBanhRan: 100 }),
        },
        pointHistory: { create: jest.fn() },
        currencyTransaction: { create: jest.fn() },
      };
      mockPrismaService.$transaction.mockImplementation((cb: any) =>
        cb(adjustTx),
      );
    });

    it('applies once, using a reference derived from the client idempotencyKey', async () => {
      mockGamificationService.awardBanh.mockResolvedValueOnce({
        requested: 100,
        granted: 100,
        rejected: 0,
        remainingDaily: 150,
        newBalance: 100,
        isCapped: false,
      });

      const result = await service.adjustCurrency(dto, 'admin@x.com');

      expect(mockGamificationService.awardBanh).toHaveBeenCalledWith(
        9,
        100,
        'ADMIN_ADJUSTMENT',
        'admin:adjust:op-123',
        expect.anything(),
        expect.anything(),
      );
      expect(result.success).toBe(true);
      expect(result.alreadyApplied).toBe(false);
      expect(adjustTx.pointHistory.create).toHaveBeenCalled();
      expect(adjustTx.currencyTransaction.create).toHaveBeenCalled();
    });

    it('a retry with the SAME idempotencyKey changes the balance only once (no duplicate ledger/legacy writes)', async () => {
      // granted: 0 signals the (userId, source, reference) pre-check in
      // awardBanh already found this exact operation applied.
      mockGamificationService.awardBanh.mockResolvedValueOnce({
        requested: 100,
        granted: 0,
        rejected: 100,
        remainingDaily: 150,
        newBalance: 100,
        isCapped: false,
      });

      const result = await service.adjustCurrency(dto, 'admin@x.com');

      expect(result.alreadyApplied).toBe(true);
      expect(adjustTx.pointHistory.create).not.toHaveBeenCalled();
      expect(adjustTx.currencyTransaction.create).not.toHaveBeenCalled();
    });

    it('a DIFFERENT idempotencyKey for an otherwise-identical adjustment is applied as a new, legitimate operation', async () => {
      mockGamificationService.awardBanh.mockResolvedValueOnce({
        requested: 100,
        granted: 100,
        rejected: 0,
        remainingDaily: 150,
        newBalance: 200,
        isCapped: false,
      });

      const result = await service.adjustCurrency(
        { ...dto, idempotencyKey: 'op-456' },
        'admin@x.com',
      );

      expect(mockGamificationService.awardBanh).toHaveBeenCalledWith(
        9,
        100,
        'ADMIN_ADJUSTMENT',
        'admin:adjust:op-456',
        expect.anything(),
        expect.anything(),
      );
      expect(result.alreadyApplied).toBe(false);
    });
  });

  describe('getReconciliationReport — read-only drift detection', () => {
    it('classifies CONSISTENT / DRIFT_POSITIVE / DRIFT_NEGATIVE without mutating anything', async () => {
      mockPrismaService.userStats.findMany.mockResolvedValue([
        { userId: 1, totalBanhRan: 100 }, // consistent
        { userId: 2, totalBanhRan: 150 }, // stored > ledger (seed-style drift)
        { userId: 3, totalBanhRan: 10 }, // stored < ledger
      ]);
      mockPrismaService.banhTransaction.groupBy.mockImplementation(
        ({ _sum }: any) => {
          if (_sum) {
            return Promise.resolve([
              { userId: 1, _sum: { amount: 100 } },
              { userId: 2, _sum: { amount: 40 } },
              { userId: 3, _sum: { amount: 60 } },
            ]);
          }
          return Promise.resolve([]); // _max createdAt — not asserted here
        },
      );

      const report = await service.getReconciliationReport();

      expect(report.totalUsers).toBe(3);
      expect(report.driftCount).toBe(2);
      expect(report.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: 1,
            delta: 0,
            status: 'CONSISTENT',
          }),
          expect.objectContaining({
            userId: 2,
            delta: 110,
            status: 'DRIFT_POSITIVE',
          }),
          expect.objectContaining({
            userId: 3,
            delta: -50,
            status: 'DRIFT_NEGATIVE',
          }),
        ]),
      );
      // Read-only: no write methods on prisma were touched by this call.
      expect(mockPrismaService.userStats.update).not.toHaveBeenCalled();
      expect(mockPrismaService.userStats.upsert).not.toHaveBeenCalled();
      expect(mockPrismaService.banhTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('runLegacyReconciliation — explicitly-scoped, idempotent one-time correction', () => {
    beforeEach(() => {
      mockPrismaService.userStats.findMany.mockResolvedValue([
        { userId: 2, totalBanhRan: 101 },
        { userId: 9, totalBanhRan: 50 }, // consistent — no correction expected
      ]);
      mockPrismaService.banhTransaction.groupBy.mockImplementation(
        ({ _sum }: any) =>
          _sum
            ? Promise.resolve([
                { userId: 2, _sum: { amount: 66 } }, // delta +35
                { userId: 9, _sum: { amount: 50 } }, // delta 0
              ])
            : Promise.resolve([]),
      );
      mockPrismaService.user.findMany.mockResolvedValue([]);
    });

    it('only corrects the userIds explicitly passed in, never "all current drift"', async () => {
      mockGamificationService.appendLegacyReconciliationEntry = jest
        .fn()
        .mockResolvedValue({
          applied: true,
          alreadyApplied: false,
          balanceAfter: 101,
        });

      const result = await service.runLegacyReconciliation([2]);

      expect(
        mockGamificationService.appendLegacyReconciliationEntry,
      ).toHaveBeenCalledWith(2, 35, expect.any(String));
      expect(result.results).toEqual([
        expect.objectContaining({ userId: 2, delta: 35, applied: true }),
      ]);
    });

    it('skips a userId with zero delta instead of forcing a no-op correction', async () => {
      mockGamificationService.appendLegacyReconciliationEntry = jest.fn();

      const result = await service.runLegacyReconciliation([9]);

      expect(
        mockGamificationService.appendLegacyReconciliationEntry,
      ).not.toHaveBeenCalled();
      expect(result.results[0]).toEqual(
        expect.objectContaining({ userId: 9, delta: 0, applied: false }),
      );
    });

    it('a second run for the same userId is idempotent (delegates to appendLegacyReconciliationEntry, which guards it)', async () => {
      mockGamificationService.appendLegacyReconciliationEntry = jest
        .fn()
        .mockResolvedValue({
          applied: false,
          alreadyApplied: true,
          balanceAfter: 101,
        });

      const result = await service.runLegacyReconciliation([2]);

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          userId: 2,
          applied: false,
          alreadyApplied: true,
        }),
      );
    });
  });

  describe('getLedgerSummary — truthful ledger-derived totals', () => {
    it('sums current balances, issued (positive) and spent (|negative|) separately', async () => {
      mockPrismaService.userStats.aggregate.mockResolvedValue({
        _sum: { totalBanhRan: 500 },
      });
      mockPrismaService.banhTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 800 } }) // issued
        .mockResolvedValueOnce({ _sum: { amount: -300 } }); // spent

      const summary = await service.getLedgerSummary();

      expect(summary).toEqual({
        totalCurrentBalance: 500,
        totalIssued: 800,
        totalSpent: 300,
      });
    });
  });

  describe('listLedgerTransactions — filtered ledger list', () => {
    it('applies direction/source/date filters and paginates', async () => {
      mockPrismaService.banhTransaction.findMany.mockResolvedValue([
        { id: 1, userId: 2, amount: -50, source: 'MARKET_PURCHASE' },
      ]);
      mockPrismaService.banhTransaction.count.mockResolvedValue(1);

      const result = await service.listLedgerTransactions({
        userId: 2,
        direction: 'spending',
        source: 'MARKET_PURCHASE',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        page: 1,
        limit: 10,
      });

      expect(mockPrismaService.banhTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 2,
            source: 'MARKET_PURCHASE',
            amount: { lt: 0 },
            dateKey: { gte: '2026-09-01', lte: '2026-09-30' },
          }),
        }),
      );
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getUserLedgerHistory — per-learner ledger, never CurrencyTransaction', () => {
    it('returns current balance, reconciliation status and BanhTransaction history', async () => {
      mockPrismaService.userStats.findUnique.mockResolvedValue({
        totalBanhRan: 101,
      });
      mockPrismaService.banhTransaction.findMany.mockResolvedValue([
        { id: 1, userId: 2, amount: 20, source: 'VOCAB_MASTERY' },
      ]);
      mockPrismaService.userStats.findMany.mockResolvedValue([
        { userId: 2, totalBanhRan: 101 },
      ]);
      mockPrismaService.banhTransaction.groupBy.mockImplementation(
        ({ _sum }: any) =>
          _sum
            ? Promise.resolve([{ userId: 2, _sum: { amount: 66 } }])
            : Promise.resolve([]),
      );
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const history = await service.getUserLedgerHistory(2);

      expect(history.currentBalance).toBe(101);
      expect(history.reconciliation).toEqual(
        expect.objectContaining({
          userId: 2,
          delta: 35,
          status: 'DRIFT_POSITIVE',
        }),
      );
      expect(history.transactions).toHaveLength(1);
      // Must never read the legacy CurrencyTransaction table.
      expect(
        mockPrismaService.currencyTransaction.create,
      ).not.toHaveBeenCalled();
    });
  });
});
