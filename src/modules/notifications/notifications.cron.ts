import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import {
  getBusinessDayKey,
  getBusinessDayStart,
} from '../../common/time/business-time.util';

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Queue worker entry point: nhắc nhở giữ chuỗi lúc 20:00 (Giờ Việt Nam).
  async runDailyStreakReminder(dayKey = getBusinessDayKey()) {
    this.logger.log('[Queue] Running daily streak reminder check...');

    try {
      const today = getBusinessDayStart(dayKey);

      // Find students with active streak who haven't studied today
      const usersWithStreak = await this.prisma.userStats.findMany({
        where: {
          streakCount: { gt: 0 },
          OR: [{ lastStreakUpdate: null }, { lastStreakUpdate: { lt: today } }],
        },
        select: {
          userId: true,
          streakCount: true,
          user: {
            select: {
              profile: {
                select: { fullName: true },
              },
            },
          },
        },
      });

      this.logger.log(
        `[Queue] Found ${usersWithStreak.length} students at risk of losing streak.`,
      );

      for (const item of usersWithStreak) {
        const studentName = item.user?.profile?.fullName || 'Học viên';
        const title = `Đừng để mất ngọn lửa Streak ${item.streakCount} ngày! 🔥`;
        const body = `Chào ${studentName}, bạn chưa hoàn thành bài học hôm nay. Học ngay 5 phút để bảo vệ chuỗi streak nhé!`;
        const url = '/practice';

        // Check if streak notification already created today for this user
        const alreadyNotified = await this.prisma.notification.findFirst({
          where: {
            userId: item.userId,
            type: 'streak',
            createdAt: { gte: today },
          },
        });

        if (!alreadyNotified) {
          await this.notificationsService.createNotification({
            userId: item.userId,
            type: 'streak',
            title,
            body,
            url,
          });

          await this.notificationsService.sendPushToUser(item.userId, {
            title,
            body,
            icon: '/icons/icon-192.png',
            url,
          });
        }
      }
    } catch (err) {
      this.logger.error('[Queue] Error in runDailyStreakReminder:', err);
      throw err;
    }
  }

  // Queue worker entry point: kiểm tra các mục từ vựng đến hạn mỗi 5 phút.
  async runVocabSpacedReview() {
    this.logger.log('[Queue] Checking due vocabulary spaced reviews...');

    try {
      const now = new Date();

      // Find all vocabulary progress items due for review that haven't been reminded yet
      const dueItems = await this.prisma.userVocabWordProgress.findMany({
        where: {
          nextReviewAt: { lte: now },
          remindedAt: null,
        },
        select: {
          id: true,
          userId: true,
          wordId: true,
          word: {
            select: {
              word: true,
              topic: {
                select: { id: true, title: true },
              },
            },
          },
        },
        take: 200,
      });

      if (dueItems.length === 0) {
        return;
      }

      this.logger.log(
        `[Queue] Found ${dueItems.length} due vocab items waiting for reminder.`,
      );

      // Claim each item with a conditional update so concurrent cron instances
      // cannot both create a reminder for the same vocabulary word.
      const claimTimestamp = now;
      const claimedItems: typeof dueItems = [];
      for (const item of dueItems) {
        const claim = await this.prisma.userVocabWordProgress.updateMany({
          where: { id: item.id, remindedAt: null },
          data: { remindedAt: claimTimestamp },
        });
        if (claim.count === 1) {
          claimedItems.push(item);
        }
      }

      if (claimedItems.length === 0) {
        return;
      }

      // Group due items by user to batch notifications
      const userItemsMap = new Map<number, typeof claimedItems>();
      for (const item of claimedItems) {
        const list = userItemsMap.get(item.userId) || [];
        list.push(item);
        userItemsMap.set(item.userId, list);
      }

      const notificationErrors: unknown[] = [];
      for (const [userId, items] of userItemsMap.entries()) {
        const count = items.length;
        const firstWord = items[0]?.word?.word || 'từ mới';
        const topicId = items[0]?.word?.topic?.id;
        const topicTitle = items[0]?.word?.topic?.title || 'Từ vựng';

        const title =
          count === 1
            ? `Đã đến giờ ôn tập từ vựng "${firstWord}" ⏰`
            : `Bạn có ${count} từ vựng cần ôn tập ngay! ⏰`;
        const body =
          count === 1
            ? `Hãy dành 1 phút để ôn tập lại từ "${firstWord}" trong chủ đề "${topicTitle}".`
            : `Bao gồm "${firstWord}" và ${count - 1} từ khác. Ôn tập đều đặn giúp ghi nhớ sâu hơn!`;
        const url = topicId ? `/practice/vocab/${topicId}` : '/flashcard';

        try {
          // 1. Create persistent in-app notification. This is the
          // authoritative delivery channel for the reminder.
          await this.notificationsService.createNotification({
            userId,
            type: 'vocab_review',
            title,
            body,
            url,
          });
        } catch (error) {
          // The claim happens before notification creation to prevent duplicate
          // reminders. If creation fails, release only this run's claims so the
          // queue retry can deliver the reminder instead of losing it forever.
          await this.prisma.userVocabWordProgress.updateMany({
            where: {
              id: { in: items.map((item) => item.id) },
              remindedAt: claimTimestamp,
            },
            data: { remindedAt: null },
          });
          notificationErrors.push(error);
          this.logger.error(
            `[Queue] Failed to create vocabulary reminder for user ${userId}; claims released for retry.`,
            error,
          );
          continue;
        }

        // 2. Send Web Push. This service deliberately swallows per-device
        // push failures so the inbox notification remains authoritative.
        try {
          await this.notificationsService.sendPushToUser(userId, {
            title,
            body,
            icon: '/icons/icon-192.png',
            url,
          });
        } catch (error) {
          this.logger.warn(
            `[Queue] Inbox reminder created but push delivery failed for user ${userId}.`,
            error,
          );
        }
      }

      if (notificationErrors.length > 0) {
        throw notificationErrors[0];
      }
    } catch (err) {
      this.logger.error('[Queue] Error in runVocabSpacedReview:', err);
      throw err;
    }
  }

  // Backward-compatible manual/admin entry points. Automated execution uses the queue.
  async handleDailyStreakReminder() {
    return this.runDailyStreakReminder();
  }

  async handleVocabSpacedReview() {
    return this.runVocabSpacedReview();
  }
}
