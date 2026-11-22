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

  describe('runWeeklyReport', () => {
    // Last week 09/11 - 15/11 of a learner whose weakest skill is Reading.
    const lastWeek = (skill: string, n: number) =>
      Array.from({ length: n }, () => ({
        userId: 19,
        skill,
        scorePercent: 80,
        createdAt: new Date('2026-11-12T10:00:00+07:00'),
      }));

    beforeEach(() => {
      prisma.learnerProgressEvent = {
        groupBy: jest.fn().mockResolvedValue([{ userId: 19 }]),
        findMany: jest
          .fn()
          .mockResolvedValue([
            ...lastWeek('LISTENING', 4),
            ...lastWeek('READING', 2),
            ...lastWeek('SPEAKING', 10),
          ]),
      };
      prisma.user = {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 19,
            learnerProfile: {
              goal: 'TOEIC_SCORE',
              minutesPerDay: 30,
              targetDate: null,
            },
          },
        ]),
      };
      prisma.learnerSkillLevel = {
        findMany: jest.fn().mockResolvedValue(
          [
            ['LISTENING', 'ADVANCED', 1.55],
            ['READING', 'STARTER', -0.25],
            ['SPEAKING', 'INTERMEDIATE', 0.4],
            ['WRITING', 'ADVANCED', 2.35],
          ].map(([skill, level, ability]) => ({
            userId: 19,
            skill,
            level,
            unlockedLevel: level,
            ability,
          })),
        ),
      };
    });

    it('puts the weakest skill first, with the dashboard week target', async () => {
      // Writing (0 of 2) is further behind, but Reading is the weakest skill:
      // TOEIC goal + weakest gives Reading 3 of 7 weights, 9 items a week.
      const result = await cronService.runWeeklyReport('2026-11-16');

      expect(result).toEqual({ week: '2026-11-16', active: 1, sent: 1 });
      expect(prisma.learnerSkillLevel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: { in: [19] } } }),
      );
      const notification =
        notificationsService.createNotification.mock.calls[0][0];
      expect(notification.type).toBe('weekly_report:2026-11-16');
      expect(notification.body).toContain(
        'Tuần này nên ưu tiên Đọc: mục tiêu 9 bài.',
      );
    });
  });

  // An account waiting for deletion, and the anonymous shell left after one,
  // gets no reminder, report or offer (owner 2026-11-21).
  describe('skips accounts waiting for deletion', () => {
    const active = { deletionRequestedAt: null, anonymizedAt: null };
    const whereOf = (mock: jest.Mock) =>
      (mock.mock.calls[0][0] as { where: Record<string, unknown> }).where;

    it('in the streak reminder and the vocabulary review', async () => {
      await cronService.handleDailyStreakReminder();
      expect(whereOf(prisma.userStats.findMany).user).toEqual(active);

      await cronService.handleVocabSpacedReview();
      expect(whereOf(prisma.userVocabWordProgress.findMany).user).toEqual(
        active,
      );
    });

    it('in the hourly study reminder', async () => {
      prisma.userStats.findMany.mockResolvedValue([]);
      // 10:00 in Vietnam: outside the quiet hours.
      await cronService.runStudyReminder(new Date('2026-11-11T03:00:00Z'));
      expect(whereOf(prisma.userStats.findMany).user).toEqual(
        expect.objectContaining(active),
      );
    });

    it('in the weekly report', async () => {
      prisma.learnerProgressEvent = {
        groupBy: jest.fn().mockResolvedValue([{ userId: 19 }]),
        findMany: jest.fn().mockResolvedValue([]),
      };
      prisma.user = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.learnerSkillLevel = { findMany: jest.fn().mockResolvedValue([]) };
      await cronService.runWeeklyReport('2026-11-16');
      expect(whereOf(prisma.user.findMany)).toEqual(
        expect.objectContaining(active),
      );
    });

    it('in the plan expiry reminder and the win-back offer', async () => {
      prisma.subscription = { findMany: jest.fn().mockResolvedValue([]) };
      await cronService.runPlanExpiryReminder('2026-11-16');
      expect(whereOf(prisma.subscription.findMany).user).toEqual(active);

      prisma.subscription.findMany.mockClear();
      await cronService.runWinback('2026-11-16');
      expect(whereOf(prisma.subscription.findMany).user).toEqual(active);
    });
  });
});
