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
    it('sends streak reminder and creates inbox notification with /practice URL', async () => {
      await cronService.handleDailyStreakReminder();

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 101,
          type: 'streak',
          url: '/practice',
        }),
      );
      expect(notificationsService.sendPushToUser).toHaveBeenCalledWith(
        101,
        expect.objectContaining({
          url: '/practice',
        }),
      );
    });
  });

  describe('handleVocabSpacedReview', () => {
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
          url: '/practice/vocab/1',
        }),
      );
      expect(notificationsService.sendPushToUser).toHaveBeenCalledWith(
        202,
        expect.objectContaining({
          url: '/practice/vocab/1',
        }),
      );
    });
  });
});
