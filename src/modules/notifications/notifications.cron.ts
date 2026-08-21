import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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

  // 2. Cron Job: Nhắc nhở lớp học online trước 30 phút (Chạy mỗi 10 phút)
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleUpcomingClassSessionReminder() {
    try {
      const now = new Date();
      const in20Mins = new Date(now.getTime() + 20 * 60 * 1000);
      const in35Mins = new Date(now.getTime() + 35 * 60 * 1000);

      const upcomingSessions = await this.prisma.session.findMany({
        where: {
          startTime: {
            gte: in20Mins,
            lte: in35Mins,
          },
        },
        include: {
          class: {
            include: {
              enrollments: {
                where: { status: 'ACTIVE' },
                select: { userId: true },
              },
            },
          },
        },
      });

      if (upcomingSessions.length === 0) return;

      this.logger.log(
        `[Cron] Found ${upcomingSessions.length} sessions starting in ~30 minutes.`,
      );

      for (const session of upcomingSessions) {
        const studentUserIds = session.class.enrollments.map((e) => e.userId);
        if (studentUserIds.length === 0) continue;

        const sessionTimeStr = session.startTime
          ? new Date(session.startTime).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '30 phút nữa';

        for (const uid of studentUserIds) {
          await this.notificationsService.sendPushToUser(uid, {
            title: `Lớp học trực tuyến sắp bắt đầu! 🎓`,
            body: `Buổi học "${session.title || 'Buổi học mới'}" của lớp "${session.class.name}" sẽ bắt đầu lúc ${sessionTimeStr}. Hãy sẵn sàng vào lớp nhé!`,
            icon: '/icons/icon-192.png',
            url: `/student/classes/${session.classId}`,
          });
        }
      }
    } catch (err) {
      this.logger.error(
        '[Cron] Error in handleUpcomingClassSessionReminder:',
        err,
      );
    }
  }
}
