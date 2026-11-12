import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  PlanPurchaseStatus,
  Prisma,
  PromoCodeSource,
  Role,
  SubscriptionStatus,
} from '@prisma/client';
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
import {
  daysUntil,
  summarizeWeeks,
  weeklyReportMessage,
  weeklyReportType,
} from './weekly-report.logic';
import {
  skillWeights,
  weekStart,
  weeklyTargets,
} from '../learning-path/week.logic';
import { GOAL_SKILLS } from '../learning-path/recommendation.logic';
import { isWinbackDay, winbackMessage, winbackType } from './winback-message';
import {
  ACTIVE_WITHIN_DAYS,
  HABIT_LOOKBACK_DAYS,
  STUDY_PUSH_TYPES,
  STUDY_REMINDER_TYPE,
  isQuietHour,
  reminderHour,
  studyReminderMessage,
  vietnamHour,
} from './study-reminder.logic';
import { MistakesService } from '../mistakes/mistakes.service';
import {
  WINBACK_AFTER_DAYS,
  WINBACK_PERCENT,
  WINBACK_VALID_DAYS,
  winbackCode,
} from '../subscription/promo.logic';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly mistakes?: MistakesService,
  ) {}

  /**
   * Whether a study reminder may be pushed to the device now: not in the
   * quiet hours, and no other study reminder (daily, vocabulary, streak)
   * today. The inbox entry is written either way.
   */
  private async mayPushStudyReminder(userId: number, now: Date) {
    if (isQuietHour(vietnamHour(now))) return false;
    const today = getBusinessDayStart(getBusinessDayKey(now));
    const earlier = await this.prisma.notification.count({
      where: {
        userId,
        type: { in: STUDY_PUSH_TYPES },
        createdAt: { gte: today },
      },
    });
    return earlier === 0;
  }

  /**
   * Queue worker entry point (every hour, Vietnam time): the daily study
   * reminder. A learner gets it at the hour they usually practise (20:00
   * until they have a habit), once a day, only if they have not studied
   * today and something concrete is waiting: a streak, due words, open
   * mistakes. Nothing is sent from 22:00 to 07:00. A rerun of the hour sends
   * nothing new (one study_reminder per learner and day).
   */
  async runStudyReminder(now = new Date()) {
    const hour = vietnamHour(now);
    if (isQuietHour(hour)) return { hour, candidates: 0, sent: 0 };
    const today = getBusinessDayStart(getBusinessDayKey(now));
    const candidates = await this.prisma.userStats.findMany({
      where: {
        user: {
          role: Role.STUDENT,
          notifications: {
            none: {
              type: { in: [STUDY_REMINDER_TYPE, 'streak'] },
              createdAt: { gte: today },
            },
          },
        },
        // Studied recently, but not today.
        lastStreakUpdate: {
          gte: new Date(today.getTime() - ACTIVE_WITHIN_DAYS * DAY_MS),
          lt: today,
        },
      },
      select: {
        userId: true,
        streakCount: true,
        user: { select: { profile: { select: { fullName: true } } } },
      },
    });
    if (candidates.length === 0) return { hour, candidates: 0, sent: 0 };

    const ids = candidates.map((c) => c.userId);
    const events = await this.prisma.learnerProgressEvent.findMany({
      where: {
        userId: { in: ids },
        createdAt: {
          gte: new Date(today.getTime() - HABIT_LOOKBACK_DAYS * DAY_MS),
        },
      },
      select: { userId: true, createdAt: true },
    });
    const practisedAt = new Map<number, Date[]>();
    for (const event of events) {
      const list = practisedAt.get(event.userId) ?? [];
      list.push(event.createdAt);
      practisedAt.set(event.userId, list);
    }
    const due = candidates.filter(
      (c) => reminderHour(practisedAt.get(c.userId) ?? []) === hour,
    );
    if (due.length === 0)
      return { hour, candidates: candidates.length, sent: 0 };

    const dueIds = due.map((c) => c.userId);
    const [words, mistakes] = await Promise.all([
      this.prisma.userVocabWordProgress.groupBy({
        by: ['userId'],
        where: { userId: { in: dueIds }, nextReviewAt: { lte: now } },
        _count: { _all: true },
      }),
      this.prisma.learnerMistake.groupBy({
        by: ['userId'],
        // TOEIC exam questions are not in the notebook (owner 2026-11-11).
        where: {
          userId: { in: dueIds },
          resolvedAt: null,
          skill: { not: 'TOEIC' },
        },
        _count: { _all: true },
      }),
    ]);
    const countOf = (
      rows: Array<{ userId: number; _count: { _all: number } }>,
      userId: number,
    ) => rows.find((row) => row.userId === userId)?._count._all ?? 0;

    let sent = 0;
    for (const learner of due) {
      const message = studyReminderMessage({
        learnerName: learner.user?.profile?.fullName,
        streak: learner.streakCount,
        dueWords: countOf(words, learner.userId),
        openMistakes: countOf(mistakes, learner.userId),
      });
      if (!message) continue;
      const push = await this.mayPushStudyReminder(learner.userId, now);
      await this.notificationsService.createNotification({
        userId: learner.userId,
        type: STUDY_REMINDER_TYPE,
        ...message,
      });
      if (push)
        await this.notificationsService.sendPushToUser(learner.userId, {
          ...message,
          icon: '/icons/icon-192.png',
        });
      sent += 1;
    }
    this.logger.log(
      `[Queue] study reminder hour=${hour} candidates=${candidates.length} due=${due.length} sent=${sent}`,
    );
    return { hour, candidates: candidates.length, sent };
  }

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

  /**
   * Queue worker entry point (Monday 08:00 Vietnam time): last week's practice
   * report for every learner who practised in the past four weeks. One report
   * per learner and week (Notification.type), so a rerun sends nothing new.
   */
  async runWeeklyReport(dayKey = getBusinessDayKey()) {
    const thisWeek = weekStart(getBusinessDayStart(dayKey));
    const weekKey = getBusinessDayKey(thisWeek);
    const type = weeklyReportType(weekKey);
    const activeSince = new Date(thisWeek.getTime() - 28 * DAY_MS);
    const active = await this.prisma.learnerProgressEvent.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: activeSince, lt: thisWeek } },
    });
    const learners = await this.prisma.user.findMany({
      where: {
        id: { in: active.map((a) => a.userId) },
        role: Role.STUDENT,
        notifications: { none: { type } },
      },
      select: {
        id: true,
        learnerProfile: {
          select: { goal: true, minutesPerDay: true, targetDate: true },
        },
      },
    });
    const events = learners.length
      ? await this.prisma.learnerProgressEvent.findMany({
          where: {
            userId: { in: learners.map((l) => l.id) },
            createdAt: {
              gte: new Date(thisWeek.getTime() - 14 * DAY_MS),
              lt: thisWeek,
            },
          },
          select: {
            userId: true,
            skill: true,
            scorePercent: true,
            createdAt: true,
          },
        })
      : [];

    const now = new Date();
    let sent = 0;
    for (const learner of learners) {
      const profile = learner.learnerProfile;
      const targets = weeklyTargets(
        profile?.minutesPerDay ?? 15,
        skillWeights(GOAL_SKILLS[profile?.goal ?? 'GENERAL'], null),
      );
      const message = weeklyReportMessage({
        mistakeTags: await this.lastWeekMistakeTags(learner.id, thisWeek),
        weekStart: thisWeek,
        skills: summarizeWeeks({
          events: events.filter((e) => e.userId === learner.id),
          weekStart: thisWeek,
          targets,
        }),
        daysToExam: daysUntil(profile?.targetDate ?? null, now),
      });
      await this.notificationsService.createNotification({
        userId: learner.id,
        type,
        title: message.title,
        body: message.body,
        url: message.url,
      });
      await this.notificationsService.sendPushToUser(learner.id, {
        title: message.title,
        body: message.body,
        icon: '/icons/icon-192.png',
        url: message.url,
      });
      sent += 1;
    }
    this.logger.log(
      `[Queue] weekly report week=${weekKey} active=${active.length} sent=${sent}`,
    );
    return { week: weekKey, active: active.length, sent };
  }

  /**
   * Queue worker entry point (09:30 Vietnam time): three days after a bought
   * plan ended, a learner who has not paid again gets a personal code, 20%
   * off any plan for 7 days, in-app, push and email. One per ended plan
   * (Notification.type), so a rerun of the day sends nothing new.
   */
  async runWinback(dayKey = getBusinessDayKey()) {
    const dayStart = getBusinessDayStart(dayKey);
    const now = new Date();
    // Plans whose last day falls in a window around the target day; the
    // exact Vietnam day is checked below.
    const ended = await this.prisma.subscription.findMany({
      where: {
        planPurchaseId: { not: null },
        status: { not: SubscriptionStatus.REVOKED },
        endsAt: {
          gte: new Date(dayStart.getTime() - (WINBACK_AFTER_DAYS + 1) * DAY_MS),
          lt: new Date(dayStart.getTime() - (WINBACK_AFTER_DAYS - 1) * DAY_MS),
        },
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
    for (const sub of ended) {
      if (!isWinbackDay(sub.endsAt, dayStart, WINBACK_AFTER_DAYS)) continue;
      // Still learning on a paid plan (a later or queued one), or paid again.
      const [running, paidAgain, already] = await Promise.all([
        this.prisma.subscription.count({
          where: {
            userId: sub.userId,
            status: SubscriptionStatus.ACTIVE,
            endsAt: { gt: now },
            planVersion: { plan: { code: { not: 'FREE' } } },
          },
        }),
        this.prisma.planPurchase.count({
          where: {
            userId: sub.userId,
            status: PlanPurchaseStatus.COMPLETED,
            completedAt: { gt: sub.endsAt },
            id: { not: sub.planPurchaseId ?? undefined },
          },
        }),
        this.prisma.notification.findFirst({
          where: { userId: sub.userId, type: winbackType(sub.id) },
          select: { id: true },
        }),
      ]);
      if (running > 0 || paidAgain > 0 || already) continue;

      const validTo = new Date(now.getTime() + WINBACK_VALID_DAYS * DAY_MS);
      const promo = await this.createWinbackCode(sub.userId, now, validTo);
      const message = winbackMessage({
        planName: sub.planVersion.plan.displayName.replace(
          /^BreadTrans\s+/,
          '',
        ),
        code: promo.code,
        percentOff: promo.percentOff,
        validTo,
        learnerName: sub.user.profile?.fullName,
      });
      await this.notificationsService.createNotification({
        userId: sub.userId,
        type: winbackType(sub.id),
        title: message.title,
        body: message.body,
        url: message.url,
      });
      await this.notificationsService.sendPushToUser(sub.userId, {
        title: message.title,
        body: message.body,
        icon: '/icons/icon-192.png',
        url: message.url,
      });
      if (this.email && sub.user.email) {
        // Email is extra: a mail failure must not stop the other offers.
        await this.email
          .sendWinbackOffer(
            sub.user.email,
            message.emailSubject,
            message.emailHtml,
          )
          .catch((error: unknown) =>
            this.logger.warn(
              `winback_email_failed subscription=${sub.id}: ${String(error).slice(0, 160)}`,
            ),
          );
      }
      sent += 1;
    }
    this.logger.log(
      `[Queue] win-back day=${dayKey} candidates=${ended.length} sent=${sent}`,
    );
    return { candidates: ended.length, sent };
  }

  /** What the learner got wrong most last week; empty when unknown. */
  private async lastWeekMistakeTags(userId: number, thisWeek: Date) {
    try {
      return (
        (await this.mistakes?.tagsBetween(
          userId,
          new Date(thisWeek.getTime() - 7 * DAY_MS),
          thisWeek,
        )) ?? []
      );
    } catch (error) {
      this.logger.warn(
        `weekly_report_mistakes_failed user=${userId}: ${String(error).slice(0, 160)}`,
      );
      return [];
    }
  }

  /** A personal code; a rare collision with an existing code just retries. */
  private async createWinbackCode(userId: number, now: Date, validTo: Date) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.promoCode.create({
          data: {
            code: winbackCode(),
            percentOff: WINBACK_PERCENT,
            validFrom: now,
            validTo,
            planCodes: [],
            maxRedemptions: 1,
            perUserOnce: true,
            source: PromoCodeSource.WINBACK,
            userId,
            note: 'Tự tạo: kéo quay lại sau khi gói hết hạn',
          },
        });
      } catch (error) {
        if (
          attempt < 4 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          continue;
        throw error;
      }
    }
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
        const title = `Đừng để mất chuỗi ${item.streakCount} ngày`;
        const body = `Chào ${studentName}, bạn chưa hoàn thành bài học hôm nay. Học ngay 5 phút để giữ chuỗi nhé!`;
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
            ? `Đã đến giờ ôn từ "${firstWord}"`
            : `Bạn có ${count} từ vựng đến hạn ôn`;
        const body =
          count === 1
            ? `Hãy dành 1 phút để ôn tập lại từ "${firstWord}" trong chủ đề "${topicTitle}".`
            : `Bao gồm "${firstWord}" và ${count - 1} từ khác. Ôn tập đều đặn giúp ghi nhớ sâu hơn!`;
        const url = topicId ? `/flashcard/${topicId}` : '/flashcard';

        let push = false;
        try {
          // Checked before the inbox entry is written, which would count
          // itself. A failure here releases the claims like any other.
          push = await this.mayPushStudyReminder(userId, now);
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

        // 2. Send Web Push, at most one study reminder a day and never in
        // the quiet hours. This service deliberately swallows per-device
        // push failures so the inbox notification remains authoritative.
        if (!push) continue;
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
