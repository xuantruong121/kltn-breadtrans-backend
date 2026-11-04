import { Injectable } from '@nestjs/common';
import { PlanPurchaseStatus, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  cohortRetention,
  latest,
  rate,
  renewalByWeek,
} from './retention-metrics.logic';

const DAY_MS = 86_400_000;
const STREAK_DAYS = 7;
const ACTIVE_DAYS = 30;

/**
 * Retention and renewal figures for the admin page, read from tables that
 * already exist: learning (LearningActivity, quiz Submission,
 * SpeakingSubmission) and paid plans (Subscription with its PlanPurchase).
 * Admin-granted plans have no purchase and are left out of renewal.
 */
@Injectable()
export class RetentionMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(requestedWeeks?: number, now = new Date()) {
    const weeks = Math.min(Math.max(Math.trunc(requestedWeeks || 12), 1), 52);
    const since = new Date(now.getTime() - weeks * 7 * DAY_MS);

    const [activities, quizzes, speaking] = await Promise.all([
      this.prisma.learningActivity.groupBy({
        by: ['userId'],
        _max: { occurredAt: true },
      }),
      this.prisma.submission.groupBy({
        by: ['userId'],
        _max: { submittedAt: true },
      }),
      this.prisma.speakingSubmission.groupBy({
        by: ['userId'],
        _max: { submittedAt: true },
      }),
    ]);
    const lastActiveAt = new Map<number, Date>();
    const merge = (userId: number, date: Date | null) => {
      const last = latest(lastActiveAt.get(userId), date);
      if (last) lastActiveAt.set(userId, last);
    };
    activities.forEach((r) => merge(r.userId, r._max.occurredAt));
    quizzes.forEach((r) => merge(r.userId, r._max.submittedAt));
    speaking.forEach((r) => merge(r.userId, r._max.submittedAt));

    const [learners, students] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: Role.STUDENT, createdAt: { gte: since } },
        select: { id: true, createdAt: true },
      }),
      this.prisma.user.findMany({
        where: { role: Role.STUDENT },
        select: { id: true },
      }),
    ]);

    // Streak share among learners who learned in the last 30 days.
    const activeSince = now.getTime() - ACTIVE_DAYS * DAY_MS;
    const activeIds = students
      .map((s) => s.id)
      .filter((id) => (lastActiveAt.get(id)?.getTime() ?? 0) >= activeSince);
    const onStreak = activeIds.length
      ? await this.prisma.userStats.count({
          where: {
            userId: { in: activeIds },
            streakCount: { gte: STREAK_DAYS },
          },
        })
      : 0;

    const ended = await this.prisma.subscription.findMany({
      where: {
        planPurchaseId: { not: null },
        status: { not: SubscriptionStatus.REVOKED },
        endsAt: { gte: since, lte: now },
      },
      select: {
        userId: true,
        endsAt: true,
        planPurchase: { select: { id: true, completedAt: true } },
      },
    });
    const userIds = [...new Set(ended.map((s) => s.userId))];
    const purchases = userIds.length
      ? await this.prisma.planPurchase.findMany({
          where: {
            userId: { in: userIds },
            status: PlanPurchaseStatus.COMPLETED,
            completedAt: { not: null },
          },
          select: { id: true, userId: true, completedAt: true },
        })
      : [];

    return {
      generatedAt: now.toISOString(),
      weeks,
      cohorts: cohortRetention({ learners, lastActiveAt, now }),
      streak: {
        days: STREAK_DAYS,
        ...rate(onStreak, activeIds.length),
      },
      renewals: renewalByWeek({
        ended: ended.flatMap((s) =>
          s.planPurchase?.completedAt
            ? [
                {
                  userId: s.userId,
                  endsAt: s.endsAt,
                  purchaseId: s.planPurchase.id,
                  purchasedAt: s.planPurchase.completedAt,
                },
              ]
            : [],
        ),
        purchases: purchases.flatMap((p) =>
          p.completedAt
            ? [{ id: p.id, userId: p.userId, completedAt: p.completedAt }]
            : [],
        ),
        now,
      }),
    };
  }
}
