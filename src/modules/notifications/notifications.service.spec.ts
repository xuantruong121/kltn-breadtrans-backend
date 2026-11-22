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
        deleteMany: jest.fn(),
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
        url: '/flashcard/1',
        isRead: false,
      });

      const res = await service.createNotification({
        userId: 10,
        type: 'vocab_review',
        title: 'Ôn từ vựng',
        body: 'Đến giờ ôn tập',
        url: '/flashcard/1',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 10,
          type: 'vocab_review',
          title: 'Ôn từ vựng',
          body: 'Đến giờ ôn tập',
          url: '/flashcard/1',
        },
      });
      expect(res.id).toBe(1);
    });
  });

  describe('getInbox', () => {
    // Newest first, as the inbox orders them. The fake applies take, cursor and
    // skip the way Prisma does: the cursor row is the start, skip 1 steps past it.
    const inbox = [5, 4, 3, 2, 1].map((id) => ({ id, title: `Item ${id}` }));
    const fakeFindMany = (args: {
      take: number;
      skip?: number;
      cursor?: { id: number };
    }) => {
      const start = args.cursor
        ? inbox.findIndex((n) => n.id === args.cursor!.id)
        : 0;
      const from = start + (args.skip ?? 0);
      return Promise.resolve(inbox.slice(from, from + args.take));
    };

    it('returns a page and the cursor of its last item', async () => {
      prisma.notification.findMany.mockImplementation(fakeFindMany);
      const res = await service.getInbox(10, 2);
      expect(res.items.map((n) => n.id)).toEqual([5, 4]);
      expect(res.nextCursor).toBe(4);
    });

    it('loses no notification when following the cursor', async () => {
      prisma.notification.findMany.mockImplementation(fakeFindMany);
      const seen: number[] = [];
      let cursor: number | undefined;
      for (let i = 0; i < 5; i++) {
        const res = await service.getInbox(10, 2, cursor);
        seen.push(...res.items.map((n) => n.id));
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      expect(seen).toEqual([5, 4, 3, 2, 1]);
    });

    it('serves numbered pages with the total', async () => {
      prisma.notification.count.mockResolvedValue(5);
      prisma.notification.findMany.mockResolvedValue([{ id: 3 }, { id: 2 }]);
      const res = await service.getInbox(10, 2, undefined, 'all', 2);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 10 },
          skip: 2,
          take: 2,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(res).toMatchObject({
        page: 2,
        pageSize: 2,
        total: 5,
        totalPages: 3,
        nextCursor: null,
      });
    });

    it('moves a page past the end back to the last page', async () => {
      // The last notification of the last page was just deleted.
      prisma.notification.count.mockResolvedValue(4);
      prisma.notification.findMany.mockResolvedValue([{ id: 2 }, { id: 1 }]);
      const res = await service.getInbox(10, 2, undefined, 'all', 3);
      expect(res.page).toBe(2);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 2 }),
      );
    });

    it('has one empty first page when there is nothing', async () => {
      prisma.notification.count.mockResolvedValue(0);
      prisma.notification.findMany.mockResolvedValue([]);
      const res = await service.getInbox(10, 20, undefined, 'unread', 1);
      expect(res).toMatchObject({
        page: 1,
        total: 0,
        totalPages: 1,
        items: [],
      });
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

  describe('filters and ownership-safe delete', () => {
    it('filters the inbox by unread state while retaining cursor pagination', async () => {
      prisma.notification.findMany.mockResolvedValue([{ id: 4 }]);
      await service.getInbox(10, 10, undefined, 'unread');
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 10, isRead: false } }),
      );
    });

    it('deletes only the authenticated user notification', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.deleteNotification(10, 7)).resolves.toEqual({
        success: true,
        id: 7,
      });
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { id: 7, userId: 10 },
      });
    });

    it('returns a safe not-found result for another user notification', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteNotification(10, 7)).resolves.toEqual({
        success: false,
        message: 'Thông báo không tồn tại',
      });
    });
  });

  describe('sendPushToUser (owner 2026-11-21)', () => {
    it('pushes only to an account that is not waiting for deletion', async () => {
      // The filter is in the query: an account waiting for deletion, or its
      // anonymous shell, matches no subscription, so nothing is sent.
      prisma.pushSubscription.findMany.mockResolvedValue([]);
      await expect(
        service.sendPushToUser(10, { title: 'Nhắc học', body: 'x' }),
      ).resolves.toEqual({ sent: 0, failed: 0 });
      expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
        where: {
          userId: 10,
          user: { deletionRequestedAt: null, anonymizedAt: null },
        },
      });
      expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
    });
  });
});
