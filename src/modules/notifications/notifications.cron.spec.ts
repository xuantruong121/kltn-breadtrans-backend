import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsCronService } from './notifications.cron';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('NotificationsCronService', () => {
  let cronService: NotificationsCronService;
  let notificationsService: any;
  let prisma: any;

  beforeEach(async () => {
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 1 }),
      sendPushToUser: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
    };

    prisma = {
      notification: {
        findFirst: jest.fn().mockResolvedValue(null),
        // Study reminders already sent today (the one-push-a-day allowance).
        count: jest.fn().mockResolvedValue(0),
      },
      userStats: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 101,
            streakCount: 5,
            user: { profile: { fullName: 'Nguyen Van A' } },
          },
        ]),
      },
      userVocabWordProgress: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            userId: 202,
            wordId: 10,
            word: {
              word: 'Accommodate',
              topic: { id: 1, title: 'Contract' },
            },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    cronService = module.get<NotificationsCronService>(
      NotificationsCronService,
    );
  });

  it('should be defined', () => {
    expect(cronService).toBeDefined();
  });

  describe('handleDailyStreakReminder', () => {
    it('sends streak reminder and creates inbox notification with dashboard URL', async () => {
      await cronService.handleDailyStreakReminder();

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 101,
          type: 'streak',
          url: '/dashboard',
        }),
      );
      expect(notificationsService.sendPushToUser).toHaveBeenCalledWith(
        101,
        expect.objectContaining({
          url: '/dashboard',
        }),
      );
    });
  });

  describe('handleVocabSpacedReview', () => {
    // 10:00 Vietnam time: outside the quiet hours, whenever the suite runs.
    beforeEach(() =>
      jest
        .useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
        .setSystemTime(new Date('2026-11-11T03:00:00Z')),
    );
    afterEach(() => jest.useRealTimers());

    it('writes the inbox entry but sends no push in the quiet hours', async () => {
      jest.setSystemTime(new Date('2026-11-11T16:30:00Z')); // 23:30 in Vietnam
      await cronService.handleVocabSpacedReview();
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 202, type: 'vocab_review' }),
      );
      expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
    });

    it('sends no second study push on the same day', async () => {
      prisma.notification.count.mockResolvedValue(1);
      await cronService.handleVocabSpacedReview();
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
    });

    it('claims due items atomically, writes inbox notification and sends push', async () => {
      await cronService.handleVocabSpacedReview();

      // Verified conditional atomic claim
      expect(prisma.userVocabWordProgress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1, remindedAt: null },
        }),
      );

      // Verified inbox creation and push send
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 202,
          type: 'vocab_review',
          url: '/flashcard/1',
        }),
      );
      expect(notificationsService.sendPushToUser).toHaveBeenCalledWith(
        202,
        expect.objectContaining({
          url: '/flashcard/1',
        }),
      );
    });

    it('releases claims when inbox notification creation fails so retries can recover', async () => {
      (
        notificationsService.createNotification as jest.Mock
      ).mockRejectedValueOnce(new Error('notification database unavailable'));

      await expect(cronService.handleVocabSpacedReview()).rejects.toThrow(
        'notification database unavailable',
      );

      expect(prisma.userVocabWordProgress.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            id: { in: [1] },
            remindedAt: expect.any(Date),
          },
          data: { remindedAt: null },
        }),
      );
      expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
    });
  });
});
