import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // 1. Cron Job: Nhắc nhở giữ chuỗi Streak lúc 20:00 hàng ngày (Giờ Việt Nam)
  @Cron('0 20 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleDailyStreakReminder() {
    this.logger.log('[Cron] Running daily streak reminder check...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

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
        `[Cron] Found ${usersWithStreak.length} students at risk of losing streak.`,
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
      this.logger.error('[Cron] Error in handleDailyStreakReminder:', err);
    }
  }

  // 2. Cron Job: Kiểm tra và gửi thông báo nhắc ôn tập từ vựng Spaced Repetition mỗi 5 phút
  @Cron('*/5 * * * *')
  async handleVocabSpacedReview() {
    this.logger.log('[Cron] Checking due vocabulary spaced reviews...');

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
        `[Cron] Found ${dueItems.length} due vocab items waiting for reminder.`,
      );

      // Claim items atomically to prevent duplicate runs
      const itemIds = dueItems.map((item) => item.id);
      await this.prisma.userVocabWordProgress.updateMany({
        where: { id: { in: itemIds } },
        data: { remindedAt: now },
      });

      // Group due items by user to batch notifications
      const userItemsMap = new Map<number, typeof dueItems>();
      for (const item of dueItems) {
        const list = userItemsMap.get(item.userId) || [];
        list.push(item);
        userItemsMap.set(item.userId, list);
      }

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

        // 1. Create persistent in-app notification
        await this.notificationsService.createNotification({
          userId,
          type: 'vocab_review',
          title,
          body,
          url,
        });

        // 2. Send Web Push
        await this.notificationsService.sendPushToUser(userId, {
          title,
          body,
          icon: '/icons/icon-192.png',
          url,
        });
      }
    } catch (err) {
      this.logger.error('[Cron] Error in handleVocabSpacedReview:', err);
    }
  }
}

