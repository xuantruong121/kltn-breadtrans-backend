import { Injectable, Logger, Optional } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { NotificationsService } from './notifications.service';
import {
  expiryMilestone,
  planExpiryMessage,
  planExpiryType,
} from './plan-expiry-message';
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
    @Optional() private readonly email?: EmailService,
  ) {}

  /**
   * Queue worker entry point (09:00 Vietnam time): remind learners 7, 3 and
   * 1 days before a paid plan ends and on its last day. Nothing is sent for a
   * plan already followed by a queued renewal, and each plan/milestone is
   * sent once (Notification.type), so a rerun of the day sends nothing new.
   */
  async runPlanExpiryReminder(dayKey = getBusinessDayKey()) {
    const dayStart = getBusinessDayStart(dayKey);
    const now = new Date();
    const windowEnd = new Date(dayStart.getTime() + 9 * 24 * 60 * 60 * 1000);
    const plans = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gt: now, lt: windowEnd },
        planVersion: { plan: { code: { not: 'FREE' } } },
      },
      include: {
        planVersion: { include: { plan: true } },
        user: {
          select: { email: true, profile: { select: { fullName: true } } },
        },
      },
    });
    let sent = 0;
    for (const plan of plans) {
      const milestone = expiryMilestone(plan.endsAt, dayStart);
      if (milestone === null) continue;
      const renewed = await this.prisma.subscription.count({
        where: {
          userId: plan.userId,
          status: SubscriptionStatus.ACTIVE,
          startsAt: { gte: plan.endsAt },
          planVersion: { plan: { code: { not: 'FREE' } } },
        },
      });
      if (renewed > 0) continue;
      const type = planExpiryType(plan.id, milestone);
      const already = await this.prisma.notification.findFirst({
        where: { userId: plan.userId, type },
        select: { id: true },
      });
      if (already) continue;

      const [quizzes, speaking, stats] = await Promise.all([
        this.prisma.submission.count({
          where: { userId: plan.userId, submittedAt: { gte: plan.startsAt } },
        }),
        this.prisma.speakingSubmission.count({
          where: { userId: plan.userId, submittedAt: { gte: plan.startsAt } },
        }),
        this.prisma.userStats.findUnique({
          where: { userId: plan.userId },
          select: { streakCount: true },
        }),
      ]);
      const message = planExpiryMessage({
        planName: plan.planVersion.plan.displayName.replace(
          /^BreadTrans\s+/,
          '',
        ),
        milestone,
        endsAt: plan.endsAt,
        practicedCount: quizzes + speaking,
        streak: stats?.streakCount ?? 0,
        learnerName: plan.user.profile?.fullName,
      });
      await this.notificationsService.createNotification({
        userId: plan.userId,
        type,
        title: message.title,
        body: message.body,
        url: message.url,
      });
      await this.notificationsService.sendPushToUser(plan.userId, {
        title: message.title,
        body: message.body,
        icon: '/icons/icon-192.png',
        url: message.url,
      });
      if (this.email && plan.user.email) {
        // Email is extra: a mail failure must not stop the other reminders.
        await this.email
          .sendPlanExpiryReminder(
            plan.user.email,
            message.emailSubject,
            message.emailHtml,
          )
          .catch((error: unknown) =>
            this.logger.warn(
              `plan_expiry_email_failed subscription=${plan.id}: ${String(error).slice(0, 160)}`,
            ),
          );
      }
      sent += 1;
    }
    this.logger.log(
      `[Queue] plan expiry reminders day=${dayKey} candidates=${plans.length} sent=${sent}`,
    );
    return { candidates: plans.length, sent };
  }

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
        const url = '/dashboard';

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
              entry: { select: { displayWord: true } },
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
        const firstWord = items[0]?.word?.entry?.displayWord || 'từ mới';
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
        const url = topicId ? `/flashcard/${topicId}` : '/flashcard';

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
