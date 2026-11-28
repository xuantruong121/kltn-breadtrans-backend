import { forgetAuthUser } from '../auth/auth-user-cache';
import {
  Injectable,
  Optional,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Role,
  PlanPaymentStatus,
  PlanPurchaseStatus,
  SubscriptionStatus,
  SuggestionStatus,
  IssueReportStatus,
  QuizPublicationStatus,
  QuizType,
  Prisma,
} from '@prisma/client';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { AuthSessionStore } from '../auth/session-store';
import { R2Service, type StorageUsage } from '../upload/r2.service';
import { R2CleanupService } from '../upload/r2-cleanup.service';
import { AccountPurgeService } from '../account/account-purge.service';
import { assertKeepsAnAdmin } from './admin-roster';
import { feedbackSummary } from './feedback-summary';
import * as bcrypt from 'bcrypt';
import { CreateUserDto, UpdateUserDto } from './dto/admin-user.dto';
import { DEFAULT_GEMINI_TEXT_MODEL } from '../ai/gemini/gemini-model-router';
import { azureTtsKey } from '../ai/azure-usage';
import {
  azureSpeechUsage,
  isGeminiCacheKey,
  R2_FREE_GB,
} from './system-costs.logic';
import {
  CreateVocabTopicDto,
  UpdateVocabTopicDto,
  CreateVocabWordDto,
  UpdateVocabWordDto,
} from '../vocab/dto';
import {
  DECK_WORD_INCLUDE,
  entryDataFromWord,
  entryTakenMessage,
  flattenDeckWord,
  headwordOf,
  isUniqueViolation,
  posOf,
  assertNotANumber,
  wordInDeckMessage,
} from '../vocab/dictionary-entry';
import { ListQuery, pageOf, wantsPage } from '../../common/paging/list-page';
import { deckListFacets, filterDeckList } from './vocab-deck-list';
import {
  deckStatsFromEntries,
  vocabDeckProblems,
} from './vocab-deck-readiness';
import {
  banhFlow,
  buildDashboardBuckets,
  learnedWithin,
  normalizeDashboardRange,
  previousDashboardStart,
} from './admin-dashboard.logic';
import { ACTIVE_ACCOUNT } from '../account/account-deletion.logic';

const SYSTEM_DICTIONARY_CATEGORY = 'SYSTEM_DICTIONARY';

function assertNotSystemCategory(categoryName?: string) {
  if (categoryName?.trim() === SYSTEM_DICTIONARY_CATEGORY)
    throw new BadRequestException(
      'Chuyên mục SYSTEM_DICTIONARY dành cho hệ thống, không dùng cho bộ từ.',
    );
}

/** Values for an entry's empty fields only: a reused entry keeps its data. */
function fillEmpty(
  entry: Record<string, unknown>,
  fields: Record<string, unknown>,
): Prisma.DictionaryEntryUpdateInput {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        value !== undefined &&
        !['headword', 'displayWord', 'pos'].includes(key) &&
        (entry[key] === null || entry[key] === undefined || entry[key] === ''),
    ),
  );
}

@Injectable()
export class AdminService {
  private storageMeasure: { at: number; usage: StorageUsage } | null = null;

  constructor(
    private prisma: PrismaService,
    private r2Service: R2Service,
    private r2CleanupService: R2CleanupService,
    private readonly accountPurge: AccountPurgeService,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {}

  async getDashboardStats(requestedRange?: string) {
    const now = new Date();
    const range = normalizeDashboardRange(requestedRange);
    const buckets = buildDashboardBuckets(range, now);
    const rangeStart = buckets[0].start;
    // The period before, for the "Kỳ trước" figures beside the main ones.
    const previousStart = previousDashboardStart(range, now);
    const inRange = { gte: rangeStart };
    const inPrevious = { gte: previousStart, lt: rangeStart };
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const paidPlan = { planVersion: { plan: { code: { not: 'FREE' } } } };

    const [
      totalStudents,
      activeStudents,
      pendingPayments,
      vocabDecks,
      grammarTopics,
      listeningLessons,
      readingLessons,
      writingLessons,
      speakingSets,
      exams,
      mediaTopics,
      marketOrdersCount,
      approvedOrdersCount,
      pendingOrdersCount,
      breadsAggregate,
      unreadSupportMessages,
      pendingSuggestions,
      openIssueReports,
      completedRevenueAgg,
      activeSubscriptionsCount,
      previousActiveStudents,
      newStudents,
      previousNewStudents,
      newStudentsWithDiagnostic,
      previousRevenueAgg,
      plansEndingSoon,
      oldestPayment,
      oldestOrder,
      oldestIssueReport,
      oldestSupportMessage,
      oldestSuggestion,
      banhBySource,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.STUDENT } }),
      this.prisma.user.count({
        where: { role: Role.STUDENT, OR: learnedWithin(inRange) },
      }),
      this.prisma.planPayment.count({
        where: {
          status: {
            in: [PlanPaymentStatus.REPORTED, PlanPaymentStatus.REVIEW_REQUIRED],
          },
        },
      }),
      // Content by area, each in its own unit. Skill practice only: TOEIC
      // quizzes and the Speaking copies inside exams are exam content, counted
      // apart as exams (owner 2026-11-26: they were added to the practice).
      this.prisma.vocabTopic.count({
        where: { categoryName: { not: 'SYSTEM_DICTIONARY' } },
      }),
      this.prisma.grammarTopic.count(),
      this.prisma.quiz.count({ where: { type: 'LISTENING_PRACTICE' } }),
      this.prisma.quiz.count({ where: { type: 'BILINGUAL_READING' } }),
      this.prisma.quiz.count({
        where: { type: { in: ['WRITING_EMAIL', 'WRITING_PICTURE'] } },
      }),
      this.prisma.speakingPracticeSet.count({
        where: { scope: 'SKILL_PRACTICE' },
      }),
      this.prisma.exam.count(),
      this.prisma.contentTopic.count(),
      // Orders placed in the chosen range; pending ones are counted whenever
      // they were placed, since they still wait (owner 2026-11-26).
      this.prisma.marketOrder.count({
        where: { createdAt: { gte: rangeStart } },
      }),
      this.prisma.marketOrder.count({
        where: { status: 'approved', createdAt: { gte: rangeStart } },
      }),
      this.prisma.marketOrder.count({ where: { status: 'pending' } }),
      this.prisma.userStats.aggregate({
        where: { user: { role: Role.STUDENT } },
        _sum: { totalBanhRan: true },
      }),
      this.prisma.supportMessage.count({
        where: { senderRole: 'STUDENT', isRead: false },
      }),
      this.prisma.suggestion.count({
        where: {
          status: {
            in: [SuggestionStatus.PENDING, SuggestionStatus.REVIEWING],
          },
        },
      }),
      this.prisma.issueReport.count({
        where: {
          status: { in: [IssueReportStatus.NEW, IssueReportStatus.IN_REVIEW] },
        },
      }),
      // Revenue of the chosen range, like the chart beside it (owner
      // 2026-11-26: the card summed every purchase whatever the range).
      this.prisma.planPurchase.aggregate({
        where: {
          status: PlanPurchaseStatus.COMPLETED,
          completedAt: { gte: rangeStart },
        },
        _sum: { amountVnd: true },
        _count: { id: true },
      }),
      // A subscription past its end date keeps status ACTIVE (every reader checks
      // endsAt instead of a sweep), so the dashboard counts the live ones only.
      this.prisma.subscription.count({
        where: {
          status: SubscriptionStatus.ACTIVE,
          endsAt: { gt: now },
        },
      }),
      this.prisma.user.count({
        where: { role: Role.STUDENT, OR: learnedWithin(inPrevious) },
      }),
      this.prisma.user.count({
        where: { role: Role.STUDENT, createdAt: inRange },
      }),
      this.prisma.user.count({
        where: { role: Role.STUDENT, createdAt: inPrevious },
      }),
      // New learners who finished the entry assessment; only the completion
      // is counted, never a level or a score.
      this.prisma.user.count({
        where: {
          role: Role.STUDENT,
          createdAt: inRange,
          diagnosticAttempts: { some: { status: 'COMPLETED' } },
        },
      }),
      this.prisma.planPurchase.aggregate({
        where: {
          status: PlanPurchaseStatus.COMPLETED,
          completedAt: inPrevious,
        },
        _sum: { amountVnd: true },
        _count: { id: true },
      }),
      // Learners whose paid plan ends within 7 days with nothing after it:
      // no queued renewal and no other paid plan running past the week, the
      // same rule as the expiry reminder.
      this.prisma.user.count({
        where: {
          role: Role.STUDENT,
          ...ACTIVE_ACCOUNT,
          subscriptions: {
            some: {
              status: SubscriptionStatus.ACTIVE,
              startsAt: { lte: now },
              endsAt: { gt: now, lte: weekAhead },
              ...paidPlan,
            },
            none: {
              status: SubscriptionStatus.ACTIVE,
              endsAt: { gt: weekAhead },
              ...paidPlan,
            },
          },
        },
      }),
      // The oldest item of each "Cần xử lý" row, for how long it has waited.
      this.prisma.planPayment.findFirst({
        where: {
          status: {
            in: [PlanPaymentStatus.REPORTED, PlanPaymentStatus.REVIEW_REQUIRED],
          },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, reportedAt: true },
      }),
      this.prisma.marketOrder.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.issueReport.findFirst({
        where: {
          status: { in: [IssueReportStatus.NEW, IssueReportStatus.IN_REVIEW] },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.supportMessage.findFirst({
        where: { senderRole: 'STUDENT', isRead: false },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.suggestion.findFirst({
        where: {
          status: {
            in: [SuggestionStatus.PENDING, SuggestionStatus.REVIEWING],
          },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      // Learners' Bánh Mì ledger of the range, summed per source for banhFlow.
      this.prisma.banhTransaction.groupBy({
        by: ['source'],
        where: { createdAt: inRange, user: { role: Role.STUDENT } },
        _sum: { amount: true },
      }),
    ]);

    // Every kind of attempt a learner makes (owner 2026-11-26: grammar and
    // exam attempts were missing, so a month with only those read 0).
    const monthlyTrends = await Promise.all(
      buckets.map(async ({ label, start, end }) => {
        const within = { gte: start, lte: end };
        const [
          submissionCount,
          speakingCount,
          grammarCount,
          toeicCount,
          contentCount,
          diagnosticCount,
          revenueAgg,
        ] = await Promise.all([
          this.prisma.submission.count({ where: { submittedAt: within } }),
          this.prisma.speakingSubmission.count({
            where: { submittedAt: within },
          }),
          this.prisma.grammarAttempt.count({ where: { createdAt: within } }),
          this.prisma.toeicAttempt.count({ where: { createdAt: within } }),
          this.prisma.contentAttempt.count({ where: { submittedAt: within } }),
          this.prisma.diagnosticAttempt.count({
            where: { submittedAt: within },
          }),
          this.prisma.planPurchase.aggregate({
            where: {
              status: PlanPurchaseStatus.COMPLETED,
              completedAt: { gte: start, lte: end },
            },
            _sum: { amountVnd: true },
          }),
        ]);

        return {
          month: label,
          activityCount:
            submissionCount +
            speakingCount +
            grammarCount +
            toeicCount +
            contentCount +
            diagnosticCount,
          revenueVnd: revenueAgg._sum.amountVnd ?? 0,
        };
      }),
    );

    const contentBreakdown = {
      vocabDecks,
      grammarTopics,
      listeningLessons,
      readingLessons,
      writingLessons,
      speakingSets,
      exams,
      mediaTopics,
    };

    const gamification = {
      totalBreads: breadsAggregate?._sum?.totalBanhRan ?? 0,
      totalOrders: marketOrdersCount,
      approvedOrders: approvedOrdersCount,
      pendingOrders: pendingOrdersCount,
      // Issued, spent and adjusted by an admin in the chosen range.
      flow: banhFlow(
        banhBySource.map((row) => ({
          source: row.source,
          total: row._sum.amount ?? 0,
        })),
      ),
    };

    const finance = {
      totalRevenueVnd: completedRevenueAgg?._sum?.amountVnd ?? 0,
      completedPurchasesCount: completedRevenueAgg?._count?.id ?? 0,
      activeSubscriptionsCount: activeSubscriptionsCount ?? 0,
      plansEndingSoon,
      previous: {
        totalRevenueVnd: previousRevenueAgg?._sum?.amountVnd ?? 0,
        completedPurchasesCount: previousRevenueAgg?._count?.id ?? 0,
      },
    };

    const waitingSince = {
      pendingPayments:
        oldestPayment?.reportedAt ?? oldestPayment?.createdAt ?? null,
      pendingOrders: oldestOrder?.createdAt ?? null,
      openIssueReports: oldestIssueReport?.createdAt ?? null,
      unreadSupportMessages: oldestSupportMessage?.createdAt ?? null,
      pendingSuggestions: oldestSuggestion?.createdAt ?? null,
    };

    return {
      range,
      stats: {
        totalStudents,
        activeStudents,
        newStudents,
        newStudentsWithDiagnostic,
        pendingPayments,
        unreadSupportMessages,
        pendingSuggestions,
        openIssueReports,
        previous: {
          activeStudents: previousActiveStudents,
          newStudents: previousNewStudents,
        },
      },
      waitingSince,
      finance,
      monthlyTrends,
      contentBreakdown,
      gamification,
    };
  }

  async getAllUsers(role?: string) {
    const users = await this.prisma.user.findMany({
      where: role ? { role: role as Role } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
        loginCount: true,
        // "Chờ xoá ngày …" / "Đã ẩn danh" badges (owner 2026-11-16).
        deletionScheduledAt: true,
        anonymizedAt: true,
        profile: { select: { fullName: true, avatar: true, phone: true } },
        stats: {
          select: {
            totalBanhRan: true,
            streakCount: true,
            lastStreakUpdate: true,
          },
        },
        learningActivities: {
          orderBy: { occurredAt: 'desc' },
          take: 1,
          select: { occurredAt: true },
        },
        submissions: {
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { submittedAt: true },
        },
        speakingSubmissions: {
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { submittedAt: true },
        },
        diagnosticAttempts: {
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { submittedAt: true },
        },
        contentAttempts: {
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { submittedAt: true },
        },
        grammarAttempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        toeicAttempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    return users.map((user) => {
      const activityDates = [
        user.lastLoginAt,
        user.stats?.lastStreakUpdate,
        user.learningActivities[0]?.occurredAt,
        user.submissions[0]?.submittedAt,
        user.speakingSubmissions[0]?.submittedAt,
        user.diagnosticAttempts[0]?.submittedAt,
        user.contentAttempts[0]?.submittedAt,
        user.grammarAttempts[0]?.createdAt,
        user.toeicAttempts[0]?.createdAt,
      ].filter(
        (value): value is Date =>
          value instanceof Date && !isNaN(value.getTime()),
      );

      const userData = { ...user };
      delete (userData as Record<string, unknown>).learningActivities;
      delete (userData as Record<string, unknown>).submissions;
      delete (userData as Record<string, unknown>).speakingSubmissions;
      delete (userData as Record<string, unknown>).assignmentSubmissions;
      delete (userData as Record<string, unknown>).diagnosticAttempts;
      delete (userData as Record<string, unknown>).contentAttempts;
      delete (userData as Record<string, unknown>).grammarAttempts;
      delete (userData as Record<string, unknown>).toeicAttempts;
      return {
        ...userData,
        lastActivityAt:
          activityDates.length > 0
            ? new Date(
                Math.max(...activityDates.map((value) => value.getTime())),
              )
            : null,
      };
    });
  }

  async getLearnerLearningTracking(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
        profile: { select: { fullName: true, avatar: true, phone: true } },
        stats: {
          select: {
            totalBanhRan: true,
            streakCount: true,
          },
        },
        leaderboard: {
          select: { totalPoints: true, weeklyExp: true, tier: true },
        },
        pet: { select: { level: true, exp: true } },
      },
    });

    if (!user) throw new NotFoundException('Không tìm thấy học viên');

    const [
      listeningSubmissions,
      listeningAttempts,
      speakingSubmissions,
      readingSubmissions,
      writingSubmissions,
      vocabProgress,
      vocabMasteredCount,
      vocabDueCount,
      grammarAttempts,
      toeicAttempts,
      recentActivity,
    ] = await Promise.all([
      this.prisma.submission.findMany({
        where: { userId, quiz: { type: QuizType.LISTENING_PRACTICE } },
        orderBy: { submittedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          score: true,
          submittedAt: true,
          quiz: { select: { id: true, title: true } },
        },
      }),
      this.prisma.listeningPracticeAttempt.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
          quiz: { select: { id: true, title: true } },
        },
      }),
      this.prisma.speakingSubmission.findMany({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          overallScore: true,
          aiFeedback: true,
          submittedAt: true,
          exercise: {
            select: {
              id: true,
              title: true,
              practiceSet: { select: { title: true } },
            },
          },
        },
      }),
      this.prisma.submission.findMany({
        where: {
          userId,
          quiz: { type: QuizType.BILINGUAL_READING },
        },
        orderBy: { submittedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          score: true,
          submittedAt: true,
          quiz: {
            select: {
              id: true,
              title: true,
              practiceTopic: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.submission.findMany({
        where: {
          userId,
          quiz: {
            type: { in: [QuizType.WRITING_PICTURE, QuizType.WRITING_EMAIL] },
          },
        },
        orderBy: { submittedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          score: true,
          aiFeedback: true,
          submittedAt: true,
          quiz: { select: { id: true, title: true, type: true } },
        },
      }),
      this.prisma.userVocabWordProgress.findMany({
        where: { userId },
        orderBy: { lastReviewedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          isMastered: true,
          reviewCount: true,
          nextReviewAt: true,
          lastReviewedAt: true,
          word: {
            select: {
              entry: { select: { displayWord: true, meaningVi: true } },
            },
          },
        },
      }),
      this.prisma.userVocabWordProgress.count({
        where: { userId, isMastered: true },
      }),
      this.prisma.userVocabWordProgress.count({
        where: {
          userId,
          isMastered: false,
          nextReviewAt: { lte: new Date() },
        },
      }),
      this.prisma.grammarAttempt.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          score: true,
          createdAt: true,
          topic: { select: { id: true, title: true, level: true } },
        },
      }),
      this.prisma.toeicAttempt.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          mode: true,
          status: true,
          createdAt: true,
          submittedAt: true,
          listeningScore: true,
          readingScore: true,
          totalScore: true,
          totalCorrect: true,
          exam: { select: { id: true, title: true, type: true } },
        },
      }),
      this.prisma.learningActivity.findMany({
        where: { userId },
        orderBy: { occurredAt: 'desc' },
        take: 20,
        select: {
          id: true,
          type: true,
          title: true,
          detail: true,
          score: true,
          durationSec: true,
          sourceType: true,
          sourceId: true,
          occurredAt: true,
        },
      }),
    ]);

    const asFiniteScore = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const feedbackScore = (feedback: unknown, keys: string[]) => {
      if (
        !feedback ||
        typeof feedback !== 'object' ||
        Array.isArray(feedback)
      ) {
        return null;
      }
      const record = feedback as Record<string, unknown>;
      for (const key of keys) {
        const score = asFiniteScore(record[key]);
        if (score !== null) return score;
      }
      return null;
    };

    return {
      learner: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        profile: user.profile,
      },
      overview: {
        recentActivityCount: recentActivity.length,
        vocabularyStudied: vocabProgress.length,
        vocabularyMastered: vocabMasteredCount,
        grammarAttempts: grammarAttempts.length,
        examAttempts: toeicAttempts.length,
      },
      skills: {
        listening: {
          attemptCount: listeningAttempts.length,
          completedCount: listeningSubmissions.length,
          recent: listeningSubmissions.map((item) => ({
            id: item.id,
            title: item.quiz.title,
            score: item.score,
            submittedAt: item.submittedAt,
          })),
          recentAttempts: listeningAttempts.map((item) => ({
            id: item.id,
            title: item.quiz.title,
            status: item.status,
            startedAt: item.startedAt,
            completedAt: item.completedAt,
            updatedAt: item.updatedAt,
          })),
        },
        speaking: {
          attemptCount: speakingSubmissions.length,
          recent: speakingSubmissions.map((item) => ({
            id: item.id,
            exerciseId: item.exercise.id,
            exerciseTitle: item.exercise.title,
            practiceSetTitle: item.exercise.practiceSet?.title ?? null,
            status: item.status,
            submittedAt: item.submittedAt,
            overallScore: item.overallScore,
            accuracy: feedbackScore(item.aiFeedback, ['accuracyScore']),
            fluency: feedbackScore(item.aiFeedback, ['fluencyScore']),
            completeness: feedbackScore(item.aiFeedback, ['completenessScore']),
            pronScore: feedbackScore(item.aiFeedback, [
              'PronScore',
              'pronScore',
              'pronunciationScore',
            ]),
          })),
        },
        reading: {
          attemptCount: readingSubmissions.length,
          recent: readingSubmissions.map((item) => ({
            id: item.id,
            title: item.quiz.title,
            topic: item.quiz.practiceTopic?.name ?? null,
            score: item.score,
            submittedAt: item.submittedAt,
          })),
        },
        writing: {
          attemptCount: writingSubmissions.length,
          recent: writingSubmissions.map((item) => ({
            id: item.id,
            title: item.quiz.title,
            type: item.quiz.type,
            score: item.score,
            feedbackSummary: feedbackSummary(item.aiFeedback),
            submittedAt: item.submittedAt,
          })),
        },
      },
      vocabulary: {
        studiedCount: vocabProgress.length,
        masteredCount: vocabMasteredCount,
        dueCount: vocabDueCount,
        recent: vocabProgress.map((item) => ({
          id: item.id,
          word: item.word.entry.displayWord,
          meaning: item.word.entry.meaningVi,
          isMastered: item.isMastered,
          reviewCount: item.reviewCount,
          nextReviewAt: item.nextReviewAt,
          lastReviewedAt: item.lastReviewedAt,
        })),
      },
      grammar: {
        attemptCount: grammarAttempts.length,
        recent: grammarAttempts.map((item) => ({
          id: item.id,
          topic: item.topic.title,
          level: item.topic.level,
          score: item.score,
          attemptedAt: item.createdAt,
        })),
      },
      exams: {
        attemptCount: toeicAttempts.length,
        recent: toeicAttempts.map((item) => ({
          id: item.id,
          exam: item.exam.title,
          mode: item.mode,
          status: item.status,
          attemptedAt: item.createdAt,
          submittedAt: item.submittedAt,
          listeningScore: item.listeningScore,
          readingScore: item.readingScore,
          totalScore: item.totalScore,
          totalCorrect: item.totalCorrect,
        })),
      },
      recentActivity,
      gamification: {
        streakCount: user.stats?.streakCount ?? 0,
        totalBanhRan: user.stats?.totalBanhRan ?? 0,
        totalPoints: user.leaderboard?.totalPoints ?? 0,
        weeklyExp: user.leaderboard?.weeklyExp ?? 0,
        tier: user.leaderboard?.tier ?? 'Đồng',
        petLevel: user.pet?.level ?? null,
        petExp: user.pet?.exp ?? null,
      },
    };
  }

  async createUser(dto: CreateUserDto) {
    if (dto.role !== Role.STUDENT && dto.role !== Role.ADMIN) {
      throw new BadRequestException('Vai trò người dùng không hợp lệ.');
    }
    const hashed = await bcrypt.hash(dto.password, 10);
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashed,
          role: dto.role,
          profile: { create: { fullName: dto.fullName, phone: dto.phone } },
        },
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          profile: { select: { fullName: true, phone: true } },
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Email đã tồn tại.');
      }
      throw error;
    }
  }

  async updateUser(userId: number, dto: UpdateUserDto) {
    const updateUserData: any = {};
    if (dto.password) {
      updateUserData.password = await bcrypt.hash(dto.password, 10);
    }

    // The role is read, checked and written in one transaction under the
    // admin-roster lock (audit A9, 2026-11-18): two admins demoting each
    // other both passed a count made before either wrote. The form always
    // sends the role; it is written only when it changes, so a name or phone
    // edit no longer ends the user's sessions.
    if (dto.role || dto.password) {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (!current) throw new NotFoundException('Người dùng không tồn tại');
        if (dto.role && dto.role !== current.role) {
          if (current.role === Role.ADMIN) await assertKeepsAnAdmin(tx, userId);
          updateUserData.role = dto.role;
        }
        if (Object.keys(updateUserData).length > 0)
          await tx.user.update({ where: { id: userId }, data: updateUserData });
      });
    }

    if (Object.keys(updateUserData).length > 0) {
      forgetAuthUser(userId);
      // A new password or role ends every session of the account.
      if (this.redis) {
        const sessions = new AuthSessionStore(this.redis);
        if (dto.password) await sessions.markPasswordChanged(userId);
        await sessions.revokeAll(userId);
      }
    }

    if (dto.fullName !== undefined || dto.phone !== undefined) {
      await this.prisma.profile.upsert({
        where: { userId },
        update: {
          fullName: dto.fullName,
          phone: dto.phone,
        },
        create: {
          userId,
          fullName: dto.fullName || 'Học viên',
          phone: dto.phone,
        },
      });
    }

    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
        loginCount: true,
        profile: { select: { fullName: true, avatar: true, phone: true } },
        stats: { select: { totalBanhRan: true, streakCount: true } },
      },
    });
  }

  /**
   * Admin "Xoá": the same purge as self-service deletion (owner 2026-11-16).
   * An account without orders or payments is deleted; one with them becomes
   * an anonymous shell that keeps those records (soft-delete rule).
   */
  async deleteUser(userId: number, actorId?: number) {
    // The admin's own account is not deleted from here (audit A9): it was
    // one click away from leaving the system with no admin.
    if (actorId !== undefined && actorId === userId)
      throw new BadRequestException(
        'Không thể xoá tài khoản Admin bạn đang đăng nhập.',
      );
    const outcome = await this.accountPurge.purgeUser(userId);
    return { id: userId, outcome };
  }

  async getVocabTopics(query: ListQuery = {}) {
    const decks = await this.prisma.vocabTopic.findMany({
      // The Speaking lookup dictionary is system data, not a deck to manage.
      where: { categoryName: { not: SYSTEM_DICTIONARY_CATEGORY } },
      include: {
        _count: { select: { words: true } },
      },
      orderBy: { id: 'asc' },
    });
    if (!wantsPage(query)) return decks;
    const page = pageOf(filterDeckList(decks, query), query);
    return {
      ...page,
      items: await this.withDeckPublishProblems(page.items),
      facets: deckListFacets(decks),
    };
  }

  /**
   * Each draft deck on the page with what blocks its publishing, so the
   * list's publish icon shows only when the server would accept it. One
   * query for the page's words; a published deck needs no check.
   */
  private async withDeckPublishProblems<
    T extends { id: number; title: string; publicationStatus: string },
  >(items: T[]): Promise<Array<T & { publishProblems: string[] }>> {
    const drafts = items
      .filter((item) => item.publicationStatus !== 'PUBLISHED')
      .map((item) => item.id);
    const words = drafts.length
      ? await this.prisma.vocabWord.findMany({
          where: { topicId: { in: drafts } },
          select: {
            topicId: true,
            entry: {
              select: { ipaUs: true, exampleEn: true, meaningVi: true },
            },
          },
        })
      : [];
    return items.map((item) => ({
      ...item,
      publishProblems: drafts.includes(item.id)
        ? vocabDeckProblems({
            title: item.title,
            stats: deckStatsFromEntries(
              words
                .filter((word) => word.topicId === item.id)
                .map((word) => word.entry),
            ),
          })
        : [],
    }));
  }

  async getVocabTopicDetail(id: number) {
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id },
      include: {
        words: {
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          include: DECK_WORD_INCLUDE,
        },
      },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    return { ...topic, words: topic.words.map(flattenDeckWord) };
  }

  /** One page of a deck's words, in learner order; `q` searches word and meaning. */
  async getVocabWordsPage(
    topicId: number,
    query: { page?: number; pageSize?: number; q?: string },
  ) {
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(Number(query.pageSize) || 20)),
    );
    const q = query.q?.trim();
    const where: Prisma.VocabWordWhereInput = {
      topicId,
      ...(q
        ? {
            entry: {
              OR: [
                { displayWord: { contains: q, mode: 'insensitive' } },
                { meaningVi: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.vocabWord.findMany({
        where,
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          entry: { include: { _count: { select: { deckWords: true } } } },
        },
      }),
      this.prisma.vocabWord.count({ where }),
    ]);
    // usedInDecks tells the editor that an edit reaches other decks too.
    const items = rows.map((row) => ({
      ...flattenDeckWord(row),
      usedInDecks: row.entry._count.deckWords,
    }));
    return { items, total, page, pageSize };
  }

  /** The deck and the counts its publish checklist needs, without the words. */
  async getVocabTopicSummary(topicId: number) {
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    const filled = (
      field: 'ipaUs' | 'exampleEn' | 'audioUs',
    ): Prisma.VocabWordWhereInput => ({
      topicId,
      entry: { AND: [{ [field]: { not: null } }, { NOT: { [field]: '' } }] },
    });
    const [total, withIpa, withExample, withAudio, meaningRows] =
      await Promise.all([
        this.prisma.vocabWord.count({ where: { topicId } }),
        this.prisma.vocabWord.count({ where: filled('ipaUs') }),
        this.prisma.vocabWord.count({ where: filled('exampleEn') }),
        this.prisma.vocabWord.count({ where: filled('audioUs') }),
        this.prisma.vocabWord.findMany({
          where: { topicId },
          select: { entry: { select: { meaningVi: true } } },
        }),
      ]);
    const meanings = [
      ...new Set(meaningRows.map((row) => row.entry.meaningVi.trim())),
    ].map((meaning) => ({ meaning }));
    const stats = {
      total,
      withIpa,
      withExample,
      distinctMeanings: meanings.length,
    };
    return {
      ...topic,
      stats: {
        ...stats,
        withAudio,
        // The quiz-step preview draws distractors from these.
        sampleMeanings: meanings.slice(0, 12).map((m) => m.meaning),
      },
      publishProblems: vocabDeckProblems({ title: topic.title, stats }),
    };
  }

  /**
   * Moves a word one place up (-1) or down (1). Swaps with the neighbour;
   * when orders collide (old decks saved order 0), renumbers the deck first.
   */
  async moveVocabWord(topicId: number, wordId: number, direction: -1 | 1) {
    const current = await this.prisma.vocabWord.findUnique({
      where: { id: wordId },
    });
    if (!current || current.topicId !== topicId)
      throw new NotFoundException('Từ vựng không tồn tại trong chủ đề này');
    const collisions = await this.prisma.vocabWord.count({
      where: { topicId, order: current.order, NOT: { id: wordId } },
    });
    if (collisions > 0) {
      const ids = (
        await this.prisma.vocabWord.findMany({
          where: { topicId },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true },
        })
      ).map((w) => w.id);
      const index = ids.indexOf(wordId);
      const target = index + direction;
      if (target < 0 || target >= ids.length) return { success: true };
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return this.reorderVocabWords(topicId, ids);
    }
    const neighbour = await this.prisma.vocabWord.findFirst({
      where: {
        topicId,
        order: direction < 0 ? { lt: current.order } : { gt: current.order },
      },
      orderBy: { order: direction < 0 ? 'desc' : 'asc' },
    });
    if (!neighbour) return { success: true };
    await this.prisma.$transaction([
      this.prisma.vocabWord.update({
        where: { id: current.id },
        data: { order: neighbour.order },
      }),
      this.prisma.vocabWord.update({
        where: { id: neighbour.id },
        data: { order: current.order },
      }),
    ]);
    return { success: true };
  }

  async createVocabTopic(dto: CreateVocabTopicDto) {
    assertNotSystemCategory(dto.categoryName);
    return this.prisma.vocabTopic.create({
      data: {
        title: dto.title,
        description: dto.description?.trim() || null,
        level: dto.level ?? null,
        categoryName: dto.categoryName || '600 TỪ VỰNG TOEIC',
        // Counts the words added below; the schema default (12) was wrong.
        totalWords: 0,
        isPro: dto.isPro ?? false,
        iconUrl: dto.iconUrl,
        publicationStatus: QuizPublicationStatus.DRAFT,
      },
    });
  }

  async updateVocabTopic(id: number, dto: UpdateVocabTopicDto) {
    assertNotSystemCategory(dto.categoryName);
    const topic = await this.prisma.vocabTopic.findUnique({ where: { id } });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    return this.prisma.vocabTopic.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && {
          description: dto.description.trim() || null,
        }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.categoryName !== undefined && {
          categoryName: dto.categoryName,
        }),
        ...(dto.isPro !== undefined && { isPro: dto.isPro }),
        ...(dto.iconUrl !== undefined && { iconUrl: dto.iconUrl }),
      },
    });
  }

  async publishVocabTopic(id: number) {
    // The words are read and counted with the topic locked (audit A8,
    // 2026-11-18): a word added or deleted while publishing changed
    // totalWords between the read and this write, and the count drifted.
    // Adding or deleting a word waits for the lock.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VocabTopic" WHERE id = ${id} FOR UPDATE`;
      const topic = await tx.vocabTopic.findUnique({
        where: { id },
        include: { words: { include: DECK_WORD_INCLUDE } },
      });
      if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
      // The editor's checklist, item for item (vocabDeckProblems).
      const missing = vocabDeckProblems({
        title: topic.title,
        stats: deckStatsFromEntries(topic.words.map((word) => word.entry)),
      });
      if (missing.length)
        throw new BadRequestException({
          message: `Chưa xuất bản được. Còn thiếu: ${missing.join('; ')}.`,
          missing,
        });
      const invalidWords = topic.words.filter(
        (w) => !w.entry.displayWord?.trim() || !w.entry.meaningVi?.trim(),
      );
      if (invalidWords.length > 0) {
        throw new BadRequestException(
          'Tất cả từ vựng phải có đầy đủ thuật ngữ và định nghĩa',
        );
      }
      return tx.vocabTopic.update({
        where: { id },
        data: {
          publicationStatus: QuizPublicationStatus.PUBLISHED,
          totalWords: topic.words.length,
        },
      });
    });
  }

  async unpublishVocabTopic(id: number) {
    const topic = await this.prisma.vocabTopic.findUnique({ where: { id } });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    return this.prisma.vocabTopic.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.DRAFT },
    });
  }

  async deleteVocabTopic(id: number) {
    // The check and the delete in one transaction, with the topic and its
    // words locked (audit A5, 2026-11-18). A learner's progress row needs its
    // word row (foreign key): it either committed before the lock and is
    // counted here, or it waits and then fails on the deleted word. Before,
    // progress saved between the check and the delete went with the topic.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VocabTopic" WHERE id = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "VocabWord" WHERE "topicId" = ${id} FOR UPDATE`;
      const topic = await tx.vocabTopic.findUnique({
        where: { id },
        include: { words: true },
      });
      if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
      // History safety guard: if any word has learner progress, block delete
      const wordIds = topic.words.map((w) => w.id);
      if (wordIds.length > 0) {
        const hasProgress = await tx.userVocabWordProgress.findFirst({
          where: { wordId: { in: wordIds } },
        });
        if (hasProgress) {
          throw new ConflictException(
            'Chủ đề từ vựng đã có dữ liệu học tập của học viên, không thể xóa',
          );
        }
      }
      return tx.vocabTopic.delete({ where: { id } });
    });
  }

  async addVocabWord(topicId: number, dto: CreateVocabWordDto) {
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    assertNotANumber(dto.word);
    // A word added without a position goes last, not to order 0.
    const last = await this.prisma.vocabWord.aggregate({
      where: { topicId },
      _max: { order: true },
    });
    // F13: a word added to a deck links the store's entry for (word, part of
    // speech); a known entry is reused (only its empty fields are filled),
    // otherwise a curated entry is created.
    const headword = headwordOf(dto.word);
    const pos = posOf(dto.pos);
    const existing = await this.prisma.dictionaryEntry.findUnique({
      where: { headword_pos: { headword, pos } },
    });
    if (existing) {
      const inDeck = await this.prisma.vocabWord.findFirst({
        where: { topicId, entryId: existing.id },
      });
      if (inDeck)
        throw new ConflictException(
          `"${dto.word.trim()}" (${pos}) đã có trong bộ này.`,
        );
    }
    const fields = entryDataFromWord(dto);
    // Two requests for the same new word race past the checks above and into
    // the unique keys: the loser gets the same 409 as the checks, not a 500.
    let entry;
    try {
      entry = existing
        ? await this.prisma.dictionaryEntry.update({
            where: { id: existing.id },
            data: {
              ...fillEmpty(existing, fields),
              ...(existing.status !== 'APPROVED' && {
                status: 'APPROVED',
                reviewedAt: new Date(),
              }),
            },
          })
        : await this.prisma.dictionaryEntry.create({
            data: {
              ...(fields as Prisma.DictionaryEntryCreateInput),
              headword,
              pos,
              displayWord: dto.word.trim(),
              meaningVi: dto.meaning.trim(),
            },
          });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(entryTakenMessage(dto.word.trim(), pos));
      throw error;
    }
    let created;
    try {
      created = await this.prisma.vocabWord.create({
        data: {
          topicId,
          entryId: entry.id,
          order: dto.order ?? (last._max.order ?? 0) + 1,
        },
        include: DECK_WORD_INCLUDE,
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(wordInDeckMessage(dto.word.trim(), pos));
      throw error;
    }
    const word = {
      ...flattenDeckWord(created),
      reusedEntry: Boolean(existing),
    };
    await this.prisma.vocabTopic.update({
      where: { id: topicId },
      data: { totalWords: { increment: 1 } },
    });
    return word;
  }

  async updateVocabWord(
    topicId: number,
    wordId: number,
    dto: UpdateVocabWordDto,
  ) {
    const word = await this.prisma.vocabWord.findUnique({
      where: { id: wordId },
      include: DECK_WORD_INCLUDE,
    });
    if (!word || word.topicId !== topicId) {
      throw new NotFoundException('Từ vựng không tồn tại trong chủ đề này');
    }
    if (dto.word !== undefined) assertNotANumber(dto.word);
    const entry = word.entry;
    const nextHeadword =
      dto.word !== undefined ? headwordOf(dto.word) : entry.headword;
    const nextPos = dto.pos !== undefined ? posOf(dto.pos) : entry.pos;
    const isWordChanged =
      nextHeadword !== entry.headword || nextPos !== entry.pos;
    const isMeaningChanged =
      dto.meaning !== undefined &&
      dto.meaning.trim() !== entry.meaningVi.trim();
    // History safety guard: what learners studied (the word in this deck, or
    // the shared meaning anywhere) does not change under them.
    if (isWordChanged || isMeaningChanged) {
      const hasProgress = await this.prisma.userVocabWordProgress.findFirst({
        where: isMeaningChanged ? { word: { entryId: entry.id } } : { wordId },
      });
      if (hasProgress) {
        throw new ConflictException(
          'Từ vựng đã có dữ liệu học tập của học viên, không thể thay đổi định danh từ vựng',
        );
      }
    }
    const fields = entryDataFromWord(dto);
    let entryId = entry.id;
    if (isWordChanged) {
      // This deck now holds a different word: link that word's entry, or
      // rename this entry when no other deck uses it, or start a new entry.
      const target = await this.prisma.dictionaryEntry.findUnique({
        where: { headword_pos: { headword: nextHeadword, pos: nextPos } },
      });
      const sharedElsewhere = await this.prisma.vocabWord.count({
        where: { entryId: entry.id, NOT: { id: wordId } },
      });
      if (target) {
        const inDeck = await this.prisma.vocabWord.findFirst({
          where: { topicId, entryId: target.id, NOT: { id: wordId } },
        });
        if (inDeck) throw new ConflictException('Từ này đã có trong bộ.');
        entryId = target.id;
        await this.prisma.dictionaryEntry.update({
          where: { id: target.id },
          data: fillEmpty(target, fields),
        });
      } else if (sharedElsewhere === 0) {
        await this.prisma.dictionaryEntry.update({
          where: { id: entry.id },
          data: { ...fields, pos: nextPos },
        });
      } else {
        const fresh = await this.prisma.dictionaryEntry.create({
          data: {
            ...(fields as Prisma.DictionaryEntryCreateInput),
            headword: nextHeadword,
            displayWord: (dto.word ?? entry.displayWord).trim(),
            pos: nextPos,
            meaningVi: (dto.meaning ?? entry.meaningVi).trim(),
            ipaUs:
              fields.ipaUs === undefined
                ? entry.ipaUs
                : (fields.ipaUs as string | null),
            ipaUk:
              fields.ipaUk === undefined
                ? entry.ipaUk
                : (fields.ipaUk as string | null),
          },
        });
        entryId = fresh.id;
      }
    } else if (Object.keys(fields).length) {
      // Same word: the shared entry is edited for every deck and lookup.
      await this.prisma.dictionaryEntry.update({
        where: { id: entry.id },
        data: {
          ...fields,
          ...(entry.status !== 'APPROVED' && {
            status: 'APPROVED',
            source: entry.source,
            reviewedAt: new Date(),
          }),
        },
      });
    }
    const updated = await this.prisma.vocabWord.update({
      where: { id: wordId },
      data: {
        entryId,
        ...(dto.order !== undefined && { order: dto.order }),
      },
      include: DECK_WORD_INCLUDE,
    });
    return flattenDeckWord(updated);
  }

  async deleteVocabWord(topicId: number, wordId: number) {
    // One transaction with the word locked, as deleteVocabTopic (audit A5);
    // the word count drops with the delete, not in a second step.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VocabWord" WHERE id = ${wordId} FOR UPDATE`;
      const word = await tx.vocabWord.findUnique({
        where: { id: wordId },
      });
      if (!word || word.topicId !== topicId) {
        throw new NotFoundException('Từ vựng không tồn tại trong chủ đề này');
      }
      // History safety guard
      const hasProgress = await tx.userVocabWordProgress.findFirst({
        where: { wordId },
      });
      if (hasProgress) {
        throw new ConflictException(
          'Từ vựng này đã có dữ liệu học tập của học viên, không thể xóa',
        );
      }
      const deleted = await tx.vocabWord.delete({
        where: { id: wordId },
      });
      await tx.vocabTopic.update({
        where: { id: topicId },
        data: { totalWords: { decrement: 1 } },
      });
      return deleted;
    });
  }

  async reorderVocabWords(topicId: number, wordIds: number[]) {
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id: topicId },
      include: { words: { select: { id: true } } },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    const existingIds = new Set(topic.words.map((w) => w.id));
    for (const wid of wordIds) {
      if (!existingIds.has(wid)) {
        throw new BadRequestException(
          `Từ vựng ID ${wid} không thuộc chủ đề này`,
        );
      }
    }
    await this.prisma.$transaction(
      wordIds.map((id, index) =>
        this.prisma.vocabWord.update({
          where: { id },
          data: { order: index },
        }),
      ),
    );
    return { success: true };
  }

  // ============== SPEAKING MANAGEMENT ==============
  async getSpeakingExercises() {
    return this.prisma.speakingExercise.findMany({
      orderBy: { id: 'desc' },
      include: {
        _count: { select: { submissions: true } },
      },
    });
  }

  createSpeakingExercise(dto: {
    title: string;
    targetText: string;
    category?: string;
    difficulty?: string;
  }) {
    void dto;
    throw new ConflictException(
      'Nội dung Nói được quản lý tại Skill CMS: /admin/skill-content/speaking.',
    );
  }

  deleteSpeakingExercise(id: number) {
    void id;
    throw new ConflictException(
      'Nội dung Nói được quản lý tại Skill CMS: /admin/skill-content/speaking.',
    );
  }

  // ============== CLOUD RESOURCES & COST MANAGEMENT (FINOPS) ==============

  async getSystemCostsOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Only return measurements that have a real source. Provider billing,
    // token usage and cache hit counts are not available in this deployment;
    // never manufacture them from submission counts.
    const [
      totalSpeakingSubmissions,
      speakingThisMonth,
      archivedSpeakingAudio,
      totalUsers,
      audioDurationThisMonth,
      diagnosticDurationThisMonth,
      listeningTtsThisMonth,
    ] = await Promise.all([
      this.prisma.speakingSubmission.count(),
      this.prisma.speakingSubmission.count({
        where: { submittedAt: { gte: startOfMonth } },
      }),
      this.prisma.speakingSubmission.count({
        where: { audioUrl: { contains: 'archived' } },
      }),
      this.prisma.user.count(),
      this.prisma.speakingSubmission.aggregate({
        where: { submittedAt: { gte: startOfMonth } },
        _sum: { durationMs: true },
      }),
      this.prisma.diagnosticSpeakingResponse.aggregate({
        where: {
          createdAt: { gte: startOfMonth },
          provider: { contains: 'azure' },
        },
        _sum: { durationMs: true },
      }),
      this.prisma.listeningAudioUsage.aggregate({
        where: { createdAt: { gte: startOfMonth }, success: true },
        _sum: { characterCount: true },
      }),
    ]);

    let cachedGeminiCount = 0;
    let geminiTotalRequests = 0;
    let geminiInputTokens = 0;
    let geminiOutputTokens = 0;
    let geminiCostUsd = 0;
    let geminiCostVnd = 0;
    let otherTtsCharacters = 0;

    if (this.redis) {
      try {
        const [keys, totalReqs, inTok, outTok, ttsCounted] = await Promise.all([
          this.redis.keys('gemini:*'),
          this.redis.get('gemini:telemetry:total_requests'),
          this.redis.get('gemini:telemetry:input_tokens'),
          this.redis.get('gemini:telemetry:output_tokens'),
          this.redis.get(azureTtsKey(now)),
        ]);
        cachedGeminiCount = keys.filter(isGeminiCacheKey).length;
        otherTtsCharacters = ttsCounted ? parseInt(ttsCounted, 10) : 0;
        let quotaSum = 0;
        const quotaKeys = keys.filter((k) =>
          k.startsWith('gemini:daily_quota:'),
        );
        if (quotaKeys.length > 0) {
          const vals = await this.redis.mget(quotaKeys);
          quotaSum = vals.reduce(
            (acc, v) => acc + (v ? parseInt(v, 10) : 0),
            0,
          );
        }
        const telemetryReqs = totalReqs ? parseInt(totalReqs, 10) : 0;
        geminiTotalRequests = Math.max(telemetryReqs, quotaSum);
        if (inTok) geminiInputTokens = parseInt(inTok, 10);
        if (outTok) geminiOutputTokens = parseInt(outTok, 10);

        // Flash Lite pricing: $0.075 / 1M input, $0.30 / 1M output
        geminiCostUsd = Number(
          (
            (geminiInputTokens * 0.075 + geminiOutputTokens * 0.3) /
            1000000
          ).toFixed(6),
        );
        geminiCostVnd = Math.round(geminiCostUsd * 25400);
      } catch {
        // Cache inventory is optional telemetry, not a billing estimate.
      }
    }

    const azure = azureSpeechUsage({
      speakingMs: audioDurationThisMonth._sum.durationMs ?? 0,
      diagnosticMs: diagnosticDurationThisMonth._sum.durationMs ?? 0,
      ttsCharacters:
        (listeningTtsThisMonth._sum.characterCount ?? 0) + otherTtsCharacters,
    });

    const r2Usage = await this.measuredStorage();
    const activeAudioCount = Math.max(
      0,
      totalSpeakingSubmissions - archivedSpeakingAudio,
    );
    const measuredStorageMb = r2Usage.totalMb;
    const r2StorageGb = Number((measuredStorageMb / 1024).toFixed(3));
    const r2UsedPercent = Math.min(
      100,
      Math.round((r2StorageGb / R2_FREE_GB) * 100),
    );

    // Azure/R2 overage cost is always 0 while usage stays within their free
    // tiers (no paid tier wired up), so the only real cost component today
    // is Gemini's token-based estimate — surface that in the headline total
    // instead of a hardcoded 0 that contradicts the Gemini card below it.
    // Its token counters are cumulative, not this month's.
    return {
      summary: {
        totalCostUsd: geminiCostUsd,
        totalCostVnd: geminiCostVnd,
        savedCostUsd: 0,
        savedCostVnd: 0,
        status: geminiTotalRequests > 0 ? 'PARTIAL' : 'UNAVAILABLE',
        activeUsers: totalUsers,
      },
      services: {
        gemini: {
          name: 'Google Gemini Generative AI',
          model: process.env.GEMINI_MODEL_NAME || DEFAULT_GEMINI_TEXT_MODEL,
          totalRequests: geminiTotalRequests,
          cachedEntries: cachedGeminiCount,
          cacheHitCount: 0,
          cacheHitRate: 0,
          inputTokens: geminiInputTokens,
          outputTokens: geminiOutputTokens,
          costUsd: geminiCostUsd,
          costVnd: geminiCostVnd,
          freeTierStatus:
            geminiTotalRequests > 0
              ? 'Đang hoạt động (Pay-as-you-go)'
              : 'Chưa kết nối dữ liệu billing',
          withinFreeTier: false,
        },
        azureSpeech: {
          name: 'Microsoft Azure AI Speech',
          totalSubmissions: totalSpeakingSubmissions,
          submissionsThisMonth: speakingThisMonth,
          ...azure,
          costUsd: 0,
          costVnd: 0,
        },
        cloudflareR2: {
          name: 'Cloudflare R2 Object Storage',
          activeAudioFiles: activeAudioCount,
          archivedAudioFiles: archivedSpeakingAudio,
          usedStorageMb: measuredStorageMb,
          usedStorageGb: r2StorageGb,
          fileCount: r2Usage.fileCount,
          storageComplete: r2Usage.complete,
          freeQuotaGb: R2_FREE_GB,
          usedPercent: r2UsedPercent,
          egressCostUsd: 0,
          costUsd: 0,
          costVnd: 0,
          withinFreeTier: r2UsedPercent < 100,
        },
      },
    };
  }

  /**
   * Listing is a billed R2 operation and the page refreshes every 30 seconds,
   * so a measurement is reused for 10 minutes. A partial one is not kept.
   */
  private async measuredStorage() {
    const now = Date.now();
    if (this.storageMeasure && now - this.storageMeasure.at < 10 * 60 * 1000)
      return this.storageMeasure.usage;
    const usage = await this.r2Service.getBucketStorageUsage();
    this.storageMeasure = usage.complete ? { at: now, usage } : null;
    return usage;
  }

  async purgeAiCache() {
    if (!this.redis) {
      return { success: true, count: 0, message: 'Redis không được kết nối' };
    }
    const allKeys = await this.redis.keys('gemini:*');
    // Preserve operational telemetry keys and daily quota keys during cache purge
    const cacheKeys = allKeys.filter(isGeminiCacheKey);
    if (cacheKeys.length > 0) {
      await this.redis.del(...cacheKeys);
    }
    return {
      success: true,
      count: cacheKeys.length,
      message: `Đã xóa thành công ${cacheKeys.length} mục cache của Gemini AI`,
    };
  }

  async triggerR2Cleanup() {
    await this.r2CleanupService.cleanupOldSpeakingAudioFiles();
    return {
      success: true,
      message:
        'Đã kích hoạt quét và dọn dẹp file ghi âm cũ trên Cloudflare R2 thành công',
    };
  }
}
