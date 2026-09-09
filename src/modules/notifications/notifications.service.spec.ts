import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createNotification', () => {
    it('creates a notification with correct attributes', async () => {
      prisma.notification.create.mockResolvedValue({
        id: 1,
        userId: 10,
        type: 'vocab_review',
        title: 'Ôn từ vựng',
        body: 'Đến giờ ôn tập',
        url: '/practice/vocab/1',
        isRead: false,
      });

      const res = await service.createNotification({
        userId: 10,
        type: 'vocab_review',
        title: 'Ôn từ vựng',
        body: 'Đến giờ ôn tập',
        url: '/practice/vocab/1',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 10,
          type: 'vocab_review',
          title: 'Ôn từ vựng',
          body: 'Đến giờ ôn tập',
          url: '/practice/vocab/1',
        },
      });
      expect(res.id).toBe(1);
    });
  });

  describe('getInbox', () => {
    it('returns items and calculates nextCursor', async () => {
      const mockItems = [
        { id: 3, title: 'Item 3' },
        { id: 2, title: 'Item 2' },
        { id: 1, title: 'Item 1' },
      ];
      prisma.notification.findMany.mockResolvedValue([...mockItems]);

      const res = await service.getInbox(10, 2);
      expect(res.items.length).toBe(2);
      expect(res.nextCursor).toBe(1);
    });
  });

  describe('getUnreadCount', () => {
    it('returns unread count', async () => {
      prisma.notification.count.mockResolvedValue(5);
      const res = await service.getUnreadCount(10);
      expect(res.count).toBe(5);
    });
  });

  describe('markRead', () => {
    it('marks notification as read', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 1, userId: 10 });
      prisma.notification.update.mockResolvedValue({ id: 1, isRead: true });

      const res = await service.markRead(10, 1);
      expect(res.success).toBe(true);
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isRead: true },
      });
    });
  });

  describe('markAllRead', () => {
    it('marks all unread as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });
      const res = await service.markAllRead(10);
      expect(res.success).toBe(true);
      expect(res.count).toBe(4);
    });
  });
});
