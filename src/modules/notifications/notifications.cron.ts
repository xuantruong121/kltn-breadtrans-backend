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
        await this.notificationsService.sendPushToUser(item.userId, {
          title: `Đừng để mất ngọn lửa Streak ${item.streakCount} ngày! 🔥`,
          body: `Chào ${studentName}, bạn chưa hoàn thành bài học hôm nay. Học ngay 5 phút để bảo vệ chuỗi streak nhé!`,
          icon: '/icons/icon-192.png',
          url: '/student/practice',
        });
      }
    } catch (err) {
      this.logger.error('[Cron] Error in handleDailyStreakReminder:', err);
    }
  }

  // 2. Cron Job: Nhắc nhở lớp học online trước 30 phút (Đã ngừng hoạt động per self-paced migration)
}
