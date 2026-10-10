import { Test, TestingModule } from '@nestjs/testing';
import { MarketService } from './market.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
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
    updateMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  leaderboard: {
    findUnique: jest.fn(),
  },
  pointHistory: {
    findMany: jest.fn(),
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
  },
  $transaction: jest.fn(),
};

const mockEventsGateway = {
  sendCurrencyUpdate: jest.fn(),
  sendOrderReviewUpdate: jest.fn(),
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
      mockPrismaService.marketProduct.findMany.mockResolvedValue([mockDigitalProduct]);
      mockPrismaService.marketOrder.findUnique.mockResolvedValue(null);
      mockPrismaService.profile.findUnique.mockResolvedValue({ fullName: 'Digital Learner' });

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          $executeRaw: jest.fn(),
          marketOrder: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 99, status: 'approved', totalBanh: 20 }),
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
        return callback(tx);
      });

      const result = await service.createOrder(1, {
        items: [{ id: 'streak-freeze', quantity: 1 }],
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('approved');
      // No userShippingProfile query required for digital items
      expect(mockPrismaService.userShippingProfile.findUnique).not.toHaveBeenCalled();
    });

    it('blocks physical item redemption when user has no shipping profile, with 0 balance deduction', async () => {
      mockPrismaService.marketProduct.findMany.mockResolvedValue([mockPhysicalProduct]);
      mockPrismaService.marketOrder.findUnique.mockResolvedValue(null);
      mockPrismaService.profile.findUnique.mockResolvedValue({ fullName: 'Learner Without Address' });
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
      mockPrismaService.marketProduct.findMany.mockResolvedValue([mockPhysicalProduct]);
      mockPrismaService.marketOrder.findUnique.mockResolvedValue(null);
      mockPrismaService.profile.findUnique.mockResolvedValue({ fullName: 'Learner QA' });
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
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        const response = err.getResponse();
        expect(response.code).toBe('SHIPPING_PROFILE_REQUIRED');
        expect(response.missingFields).toContain('phone');
      }

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('creates order and snapshots shipping information immutably when shipping profile is complete', async () => {
      mockPrismaService.marketProduct.findMany.mockResolvedValue([mockPhysicalProduct]);
      mockPrismaService.marketOrder.findUnique.mockResolvedValue(null);
      mockPrismaService.profile.findUnique.mockResolvedValue({ fullName: 'Learner QA' });

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
      mockPrismaService.userShippingProfile.findUnique.mockResolvedValue(mockShipping);

      let createdRedemption: any = null;

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          $executeRaw: jest.fn(),
          marketOrder: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 101, status: 'pending', totalBanh: 100 }),
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
            create: jest.fn().mockImplementation(({ data }) => {
              createdRedemption = data;
              return { id: 1, ...data };
            }),
          },
        };
        return callback(tx);
      });

      const result = await service.createOrder(2, {
        items: [{ id: 'gift-bottle', quantity: 1 }],
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('pending');
      expect(createdRedemption).toBeDefined();
      expect(createdRedemption.recipientName).toBe('Nguyễn Văn QA');
      expect(createdRedemption.phone).toBe('+84987654321');
      expect(createdRedemption.provinceCode).toBe('79');
      expect(createdRedemption.provinceName).toBe('Thành phố Hồ Chí Minh');
      expect(createdRedemption.wardCode).toBe('26734');
      expect(createdRedemption.wardName).toBe('Phường 1');
      expect(createdRedemption.addressLine).toBe('12 Nguyễn Văn Bảo');
      expect(createdRedemption.formattedAddress).toBe(
        '12 Nguyễn Văn Bảo, Phường 1, Thành phố Hồ Chí Minh, Việt Nam',
      );
      expect(createdRedemption.status).toBe('PENDING');
    });
  });
});
