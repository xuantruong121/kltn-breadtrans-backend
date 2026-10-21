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
  CourseStatus,
  CourseLessonAttemptStatus,
  CourseLessonStatus,
  EnrollmentStatus,
  PaymentStatus,
  SuggestionStatus,
  IssueReportStatus,
  TopicCategory,
  QuizPublicationStatus,
  QuizType,
} from '@prisma/client';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { R2Service } from '../upload/r2.service';
import { R2CleanupService } from '../upload/r2-cleanup.service';
import * as bcrypt from 'bcrypt';
import { CourseService } from '../course/course.service';
import { CreateUserDto, UpdateUserDto } from './dto/admin-user.dto';
import { DEFAULT_GEMINI_TEXT_MODEL } from '../ai/gemini/gemini-model-router';
import {
  CreateVocabTopicDto,
  UpdateVocabTopicDto,
  CreateVocabWordDto,
  UpdateVocabWordDto,
} from '../vocab/dto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private r2Service: R2Service,
    private r2CleanupService: R2CleanupService,
    private courseService: CourseService,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {}

  async getDashboardStats() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalStudents,
      activeStudents,
      totalCourses,
      pendingCourses,
      totalEnrollments,
      activeEnrollments,
      pendingPayments,
      recentEnrollments,
      totalVocabTopics,
      totalGrammarTopics,
      totalQuizzes,
      totalSpeaking,
      totalAssignments,
      totalContentTopics,
      marketOrdersCount,
      approvedOrdersCount,
      pendingOrdersCount,
      breadsAggregate,
      unreadSupportMessages,
      pendingSuggestions,
      openIssueReports,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.STUDENT } }),
      this.prisma.user.count({
        where: {
          role: Role.STUDENT,
          OR: [
            { lastLoginAt: { gte: thirtyDaysAgo } },
            {
              learningActivities: {
                some: { occurredAt: { gte: thirtyDaysAgo } },
              },
            },
            { submissions: { some: { submittedAt: { gte: thirtyDaysAgo } } } },
            {
              speakingSubmissions: {
                some: { submittedAt: { gte: thirtyDaysAgo } },
              },
            },
            {
              assignmentSubmissions: {
                some: { submittedAt: { gte: thirtyDaysAgo } },
              },
            },
            {
              diagnosticAttempts: {
                some: { submittedAt: { gte: thirtyDaysAgo } },
              },
            },
            {
              contentAttempts: {
                some: { submittedAt: { gte: thirtyDaysAgo } },
              },
            },
            {
              grammarAttempts: { some: { createdAt: { gte: thirtyDaysAgo } } },
            },
            { toeicAttempts: { some: { createdAt: { gte: thirtyDaysAgo } } } },
          ],
        },
      }),
      this.prisma.course.count({ where: { status: CourseStatus.PUBLISHED } }),
      this.prisma.course.count({ where: { status: CourseStatus.DRAFT } }),
      this.prisma.enrollment.count(),
      this.prisma.enrollment.count({
        where: { status: EnrollmentStatus.ACTIVE },
      }),
      this.prisma.payment.count({
        where: {
          status: {
            in: [PaymentStatus.REPORTED, PaymentStatus.REVIEW_REQUIRED],
          },
        },
      }),
      this.prisma.enrollment.findMany({
        take: 10,
        orderBy: { joinedAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              profile: { select: { fullName: true, avatar: true } },
            },
          },
          class: {
            select: {
              id: true,
              name: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      }),
      this.prisma.vocabTopic.count(),
      this.prisma.grammarTopic.count(),
      this.prisma.quiz.count(),
      this.prisma.speakingExercise.count(),
      this.prisma.assignment.count(),
      this.prisma.contentTopic.count(),
      this.prisma.marketOrder.count(),
      this.prisma.marketOrder.count({ where: { status: 'approved' } }),
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
    ]);

    const recentActivity = recentEnrollments.map((e) => ({
      id: e.id,
      type: 'enrollment',
      message: `${e.user.profile?.fullName || e.user.email} vừa được cấp quyền truy cập "${e.class.course.title}"`,
      avatar: e.user.profile?.avatar || null,
      createdAt: e.joinedAt,
    }));

    // Generate accurate monthly trends for the last 6 calendar months
    const now = new Date();
    const monthWindows: { label: string; start: Date; end: Date }[] = [];
    for (let i = 5; i >= 0; i--) {
      const year = now.getFullYear();
      const month = now.getMonth() - i;
      const start = new Date(year, month, 1, 0, 0, 0, 0);
      const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
      const label = `T${start.getMonth() + 1}`;
      monthWindows.push({ label, start, end });
    }

    const monthlyTrends = await Promise.all(
      monthWindows.map(async ({ label, start, end }) => {
        const [enrollmentCount, submissionCount, speakingCount] =
          await Promise.all([
            this.prisma.enrollment.count({
              where: { joinedAt: { gte: start, lte: end } },
            }),
            this.prisma.submission.count({
              where: { submittedAt: { gte: start, lte: end } },
            }),
            this.prisma.speakingSubmission.count({
              where: { submittedAt: { gte: start, lte: end } },
            }),
          ]);

        return {
          month: label,
          enrollments: enrollmentCount,
          activityCount: submissionCount + speakingCount,
        };
      }),
    );

    const contentBreakdown = {
      vocab: totalVocabTopics,
      grammar: totalGrammarTopics,
      quizzes: totalQuizzes,
      speaking: totalSpeaking,
      media: totalContentTopics + totalAssignments,
    };

    const gamification = {
      totalBreads: breadsAggregate?._sum?.totalBanhRan ?? 0,
      totalOrders: marketOrdersCount,
      approvedOrders: approvedOrdersCount,
      pendingOrders: pendingOrdersCount,
    };

    return {
      stats: {
        totalStudents,
        activeStudents,
        totalCourses,
        pendingCourses,
        totalEnrollments,
        activeEnrollments,
        pendingPayments,
        unreadSupportMessages,
        pendingSuggestions,
        openIssueReports,
      },
      monthlyTrends,
      contentBreakdown,
      gamification,
      recentActivity,
    };
  }

  async getListeningAnalytics() {
    const quizzes = await this.prisma.quiz.findMany({
      where: { type: 'LISTENING_PRACTICE' },
      select: {
        id: true,
        title: true,
        publicationStatus: true,
        questions: { select: { id: true, type: true, content: true } },
      },
      orderBy: { id: 'desc' },
    });
    const quizIds = quizzes.map((quiz) => quiz.id);
    const [attempts, submissions] = await Promise.all([
      this.prisma.listeningPracticeAttempt.findMany({
        where: { quizId: { in: quizIds } },
        select: { quizId: true, status: true },
      }),
      this.prisma.submission.findMany({
        where: { quizId: { in: quizIds } },
        select: { quizId: true, score: true },
      }),
    ]);
    const byQuiz = (id: number) => ({
      attempts: attempts.filter((item) => item.quizId === id),
      submissions: submissions.filter((item) => item.quizId === id),
    });
    const items = quizzes.map((quiz) => {
      const stats = byQuiz(quiz.id);
      const scored = stats.submissions
        .map((item) => item.score)
        .filter((score): score is number => typeof score === 'number');
      const dictationCount = quiz.questions.filter((question) => {
        const content = question.content as Record<string, unknown>;
        return (
          question.type === 'DICTATION' || content.practiceKind === 'DICTATION'
        );
      }).length;
      return {
        quizId: quiz.id,
        title: quiz.title,
        publicationStatus: quiz.publicationStatus,
        questionCount: quiz.questions.length,
        dictationCount,
        attemptCount: stats.attempts.length,
        completedAttemptCount: stats.attempts.filter(
          (item) => item.status === 'COMPLETED',
        ).length,
        submissionCount: stats.submissions.length,
        averageScore: scored.length
          ? Number(
              (
                scored.reduce((sum, score) => sum + score, 0) / scored.length
              ).toFixed(2),
            )
          : null,
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        quizzes: items.length,
        questions: items.reduce((sum, item) => sum + item.questionCount, 0),
        attempts: items.reduce((sum, item) => sum + item.attemptCount, 0),
        submissions: items.reduce((sum, item) => sum + item.submissionCount, 0),
      },
      items,
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
        assignmentSubmissions: {
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
        user.assignmentSubmissions[0]?.submittedAt,
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
        enrollments: {
          where: { status: EnrollmentStatus.ACTIVE },
          select: {
            class: {
              select: {
                course: { select: { id: true, title: true, level: true } },
              },
            },
          },
        },
      },
    });

    if (!user) throw new NotFoundException('Không tìm thấy học viên');

    const enrolledCourseIds = user.enrollments.map(
      (enrollment) => enrollment.class.course.id,
    );

    const [
      courseLessons,
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
      this.prisma.courseLesson.findMany({
        where: {
          status: CourseLessonStatus.PUBLISHED,
          OR: [
            ...(enrolledCourseIds.length
              ? [{ courseId: { in: enrolledCourseIds } }]
              : []),
            { attempts: { some: { userId } } },
          ],
        },
        orderBy: [{ courseId: 'asc' }, { order: 'asc' }],
        select: {
          id: true,
          title: true,
          order: true,
          course: { select: { id: true, title: true, level: true } },
          exercises: {
            where: { required: true },
            select: { id: true, minimumScore: true },
          },
          attempts: {
            where: { userId, status: CourseLessonAttemptStatus.SUBMITTED },
            orderBy: { createdAt: 'desc' },
            select: {
              exerciseId: true,
              score: true,
              maxScore: true,
              submittedAt: true,
              createdAt: true,
            },
          },
        },
      }),
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
          word: { select: { word: true, meaning: true } },
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

    const isSuccessful = (
      score: number | null,
      maxScore: number | null,
      minimumScore: number | null,
    ) =>
      score !== null &&
      maxScore !== null &&
      maxScore > 0 &&
      (minimumScore !== null
        ? (score / maxScore) * 100 >= minimumScore
        : score === maxScore);

    const coursesById = new Map<number, any>();
    for (const enrollment of user.enrollments) {
      const course = enrollment.class.course;
      coursesById.set(course.id, {
        id: course.id,
        title: course.title,
        level: course.level,
        completedLessons: 0,
        totalLessons: 0,
        lessons: [],
      });
    }
    for (const lesson of courseLessons) {
      const latestByExercise = new Map<
        number,
        (typeof lesson.attempts)[number]
      >();
      for (const attempt of lesson.attempts) {
        if (!latestByExercise.has(attempt.exerciseId)) {
          latestByExercise.set(attempt.exerciseId, attempt);
        }
      }
      const completed = lesson.exercises.every((exercise) => {
        const attempt = latestByExercise.get(exercise.id);
        return Boolean(
          attempt &&
          isSuccessful(attempt.score, attempt.maxScore, exercise.minimumScore),
        );
      });
      const course = coursesById.get(lesson.course.id) ?? {
        id: lesson.course.id,
        title: lesson.course.title,
        level: lesson.course.level,
        completedLessons: 0,
        totalLessons: 0,
        lessons: [],
      };
      course.totalLessons += 1;
      if (completed) course.completedLessons += 1;
      course.lessons.push({
        id: lesson.id,
        title: lesson.title,
        order: lesson.order,
        completed,
        lastActivityAt:
          lesson.attempts[0]?.submittedAt ??
          lesson.attempts[0]?.createdAt ??
          null,
      });
      coursesById.set(course.id, course);
    }

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
    const feedbackSummary = (feedback: string | null) => {
      if (!feedback) return null;
      const normalized = feedback.replace(/\s+/g, ' ').trim();
      return normalized.length > 180
        ? `${normalized.slice(0, 177)}...`
        : normalized;
    };

    const totalCourseLessons = [...coursesById.values()].reduce(
      (sum, course) => sum + course.totalLessons,
      0,
    );
    const completedCourseLessons = [...coursesById.values()].reduce(
      (sum, course) => sum + course.completedLessons,
      0,
    );

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
        courseCount: coursesById.size,
        completedCourseLessons,
        totalCourseLessons,
        courseProgressPercent: totalCourseLessons
          ? Math.round((completedCourseLessons / totalCourseLessons) * 100)
          : null,
        recentActivityCount: recentActivity.length,
        vocabularyStudied: vocabProgress.length,
        vocabularyMastered: vocabMasteredCount,
        grammarAttempts: grammarAttempts.length,
        examAttempts: toeicAttempts.length,
      },
      courses: [...coursesById.values()].map((course) => ({
        ...course,
        progressPercent: course.totalLessons
          ? Math.round((course.completedLessons / course.totalLessons) * 100)
          : null,
      })),
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
          word: item.word.word,
          meaning: item.word.meaning,
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
    return this.prisma.user.create({
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
  }

  async updateUser(userId: number, dto: UpdateUserDto) {
    if (dto.role && dto.role !== Role.ADMIN) {
      const existingUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (existingUser?.role === Role.ADMIN) {
        const adminCount = await this.prisma.user.count({
          where: { role: Role.ADMIN },
        });
        if (adminCount <= 1) {
          throw new BadRequestException(
            'Không thể hạ quyền Admin duy nhất trong hệ thống.',
          );
        }
      }
    }

    const updateUserData: any = {};
    if (dto.role) updateUserData.role = dto.role;
    if (dto.password) {
      updateUserData.password = await bcrypt.hash(dto.password, 10);
    }

    if (Object.keys(updateUserData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: updateUserData,
      });
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

  async deleteUser(userId: number) {
    return await this.prisma.$transaction(async (tx) => {
      const lockedUsers = await tx.$queryRaw<Array<{ id: number; role: Role }>>`
        SELECT id, role
        FROM "User"
        WHERE id = ${userId}
        FOR UPDATE;
      `;

      if (!lockedUsers || lockedUsers.length === 0) {
        throw new NotFoundException('Người dùng không tồn tại');
      }

      const paymentCount = await tx.payment.count({
        where: {
          OR: [{ enrollment: { userId } }, { reviewedById: userId }],
        },
      });

      if (paymentCount > 0) {
        throw new ConflictException(
          'Không thể xóa người dùng vì tồn tại lịch sử thanh toán hoặc lịch sử duyệt cần được lưu giữ.',
        );
      }

      return tx.user.delete({ where: { id: userId } });
    });
  }

  async enrollUserInClass(userId: number, classId: number) {
    return this.courseService.enrollInClass(classId, userId, {
      isAdminOverride: true,
    });
  }

  async removeEnrollment(userId: number, classId: number) {
    const paymentCount = await this.prisma.payment.count({
      where: { enrollment: { userId, classId } },
    });
    if (paymentCount > 0) {
      throw new ConflictException(
        'Không thể xóa ghi danh vì tồn tại lịch sử thanh toán cần được lưu giữ.',
      );
    }
    return this.prisma.enrollment.deleteMany({ where: { userId, classId } });
  }

  async getEnrollmentsByClass(classId: number) {
    return this.prisma.enrollment.findMany({
      where: { classId },
      orderBy: { joinedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, avatar: true, phone: true } },
          },
        },
      },
    });
  }

  // ============== COURSE MANAGEMENT ==============

  async getAdminCourses() {
    const courses = await this.prisma.course.findMany({
      include: {
        classes: {
          include: {
            _count: { select: { enrollments: true } },
            enrollments: {
              where: { status: EnrollmentStatus.ACTIVE },
              select: { id: true },
            },
          },
        },
        _count: { select: { classes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return courses.map((course) => ({
      ...course,
      classes: (course.classes || []).map((cls) => {
        const totalEnrollmentCount = cls._count?.enrollments ?? 0;
        const activeEnrollmentCount = cls.enrollments?.length ?? 0;
        return {
          ...cls,
          tuitionFeeVnd: cls.tuitionFeeVnd ?? 0,
          activeEnrollmentCount,
          totalEnrollmentCount,
          hasEnrollments: totalEnrollmentCount > 0,
          studentCount: activeEnrollmentCount,
        };
      }),
    }));
  }

  async adminCreateCourse(dto: {
    title: string;
    description?: string;
    thumbnail?: string;
    level?: string;
  }) {
    return this.courseService.createCourse(dto, { id: 0, role: Role.ADMIN });
  }

  async adminUpdateCourse(
    courseId: number,
    dto: {
      title?: string;
      description?: string;
      thumbnail?: string;
      level?: string;
      status?: any;
    },
  ) {
    return this.courseService.updateCourse(courseId, dto, {
      id: 0,
      role: Role.ADMIN,
    });
  }

  async adminDeleteCourse(courseId: number) {
    return this.courseService.deleteCourse(courseId, {
      id: 0,
      role: Role.ADMIN,
    });
  }

  async adminReviewCourse(courseId: number, action: 'APPROVE' | 'REJECT') {
    return this.courseService.reviewCourse(courseId, action, {
      id: 0,
      role: Role.ADMIN,
    });
  }

  // ============== CLASS MANAGEMENT ==============

  async getAllClasses() {
    const classes = await this.prisma.class.findMany({
      include: {
        course: { select: { id: true, title: true, thumbnail: true } },
        _count: { select: { enrollments: true } },
        enrollments: {
          where: { status: EnrollmentStatus.ACTIVE },
          select: { id: true },
        },
      },
      orderBy: { id: 'desc' },
    });

    return classes.map((cls) => {
      const totalEnrollmentCount = cls._count?.enrollments ?? 0;
      const activeEnrollmentCount = cls.enrollments?.length ?? 0;
      return {
        ...cls,
        tuitionFeeVnd: cls.tuitionFeeVnd ?? 0,
        activeEnrollmentCount,
        totalEnrollmentCount,
        hasEnrollments: totalEnrollmentCount > 0,
        studentCount: activeEnrollmentCount,
      };
    });
  }

  async adminCreateClass(
    courseId: number,
    dto: {
      name: string;
      startDate?: string;
      endDate?: string;
      capacity?: number;
    },
  ) {
    return this.courseService.createClass(
      courseId,
      { id: 0, role: Role.ADMIN },
      dto,
    );
  }

  async getClassWithEnrollments(classId: number) {
    return this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        course: { select: { id: true, title: true, thumbnail: true } },
        enrollments: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                profile: {
                  select: { fullName: true, avatar: true, phone: true },
                },
              },
            },
          },
          orderBy: { joinedAt: 'desc' },
        },
        _count: { select: { enrollments: true } },
      },
    });
  }

  // ============== VOCAB MANAGEMENT (PHASE 4 CMS) ==============
  async getVocabTopics() {
    return this.prisma.vocabTopic.findMany({
      include: {
        _count: { select: { words: true } },
      },
      orderBy: { id: 'asc' },
    });
  }

  async getVocabTopicDetail(id: number) {
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id },
      include: {
        words: {
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    return topic;
  }

  async createVocabTopic(dto: CreateVocabTopicDto) {
    return this.prisma.vocabTopic.create({
      data: {
        title: dto.title,
        categoryName: dto.categoryName || '600 TỪ VỰNG TOEIC',
        isPro: dto.isPro ?? false,
        iconUrl: dto.iconUrl,
        publicationStatus: QuizPublicationStatus.DRAFT,
      },
    });
  }

  async updateVocabTopic(id: number, dto: UpdateVocabTopicDto) {
    const topic = await this.prisma.vocabTopic.findUnique({ where: { id } });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    return this.prisma.vocabTopic.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.categoryName !== undefined && {
          categoryName: dto.categoryName,
        }),
        ...(dto.isPro !== undefined && { isPro: dto.isPro }),
        ...(dto.iconUrl !== undefined && { iconUrl: dto.iconUrl }),
      },
    });
  }

  async publishVocabTopic(id: number) {
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id },
      include: { words: true },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    if (!topic.words || topic.words.length === 0) {
      throw new BadRequestException(
        'Chủ đề từ vựng phải có ít nhất 1 từ vựng trước khi xuất bản',
      );
    }
    const invalidWords = topic.words.filter(
      (w) => !w.word?.trim() || !w.meaning?.trim(),
    );
    if (invalidWords.length > 0) {
      throw new BadRequestException(
        'Tất cả từ vựng phải có đầy đủ thuật ngữ và định nghĩa',
      );
    }
    return this.prisma.vocabTopic.update({
      where: { id },
      data: {
        publicationStatus: QuizPublicationStatus.PUBLISHED,
        totalWords: topic.words.length,
      },
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
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id },
      include: { words: true },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    // History safety guard: if any word has learner progress, block delete
    const wordIds = topic.words.map((w) => w.id);
    if (wordIds.length > 0) {
      const hasProgress = await this.prisma.userVocabWordProgress.findFirst({
        where: { wordId: { in: wordIds } },
      });
      if (hasProgress) {
        throw new ConflictException(
          'Chủ đề từ vựng đã có dữ liệu học tập của học viên, không thể xóa',
        );
      }
    }
    return this.prisma.vocabTopic.delete({ where: { id } });
  }

  async addVocabWord(topicId: number, dto: CreateVocabWordDto) {
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic) throw new NotFoundException('Chủ đề từ vựng không tồn tại');
    const word = await this.prisma.vocabWord.create({
      data: {
        topicId,
        word: dto.word,
        pos: dto.pos || 'noun',
        ipaUs: dto.ipaUs,
        ipaUk: dto.ipaUk,
        meaning: dto.meaning,
        audioUs: dto.audioUs,
        audioUk: dto.audioUk,
        exampleEn: dto.exampleEn,
        exampleVi: dto.exampleVi,
        collocations: dto.collocations ?? undefined,
        order: dto.order ?? 0,
      },
    });
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
    });
    if (!word || word.topicId !== topicId) {
      throw new NotFoundException('Từ vựng không tồn tại trong chủ đề này');
    }
    // History safety guard: if learner progress exists, block semantic identity change
    const isWordChanged =
      dto.word &&
      dto.word.trim().toLowerCase() !== word.word.trim().toLowerCase();
    const isMeaningChanged =
      dto.meaning && dto.meaning.trim() !== word.meaning.trim();
    if (isWordChanged || isMeaningChanged) {
      const hasProgress = await this.prisma.userVocabWordProgress.findFirst({
        where: { wordId },
      });
      if (hasProgress) {
        throw new ConflictException(
          'Từ vựng đã có dữ liệu học tập của học viên, không thể thay đổi định danh từ vựng',
        );
      }
    }
    return this.prisma.vocabWord.update({
      where: { id: wordId },
      data: {
        ...(dto.word !== undefined && { word: dto.word }),
        ...(dto.meaning !== undefined && { meaning: dto.meaning }),
        ...(dto.pos !== undefined && { pos: dto.pos }),
        ...(dto.ipaUs !== undefined && { ipaUs: dto.ipaUs }),
        ...(dto.ipaUk !== undefined && { ipaUk: dto.ipaUk }),
        ...(dto.audioUs !== undefined && { audioUs: dto.audioUs }),
        ...(dto.audioUk !== undefined && { audioUk: dto.audioUk }),
        ...(dto.exampleEn !== undefined && { exampleEn: dto.exampleEn }),
        ...(dto.exampleVi !== undefined && { exampleVi: dto.exampleVi }),
        ...(dto.collocations !== undefined && {
          collocations: dto.collocations,
        }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });
  }

  async deleteVocabWord(topicId: number, wordId: number) {
    const word = await this.prisma.vocabWord.findUnique({
      where: { id: wordId },
    });
    if (!word || word.topicId !== topicId) {
      throw new NotFoundException('Từ vựng không tồn tại trong chủ đề này');
    }
    // History safety guard
    const hasProgress = await this.prisma.userVocabWordProgress.findFirst({
      where: { wordId },
    });
    if (hasProgress) {
      throw new ConflictException(
        'Từ vựng này đã có dữ liệu học tập của học viên, không thể xóa',
      );
    }
    const deleted = await this.prisma.vocabWord.delete({
      where: { id: wordId },
    });
    await this.prisma.vocabTopic.update({
      where: { id: topicId },
      data: { totalWords: { decrement: 1 } },
    });
    return deleted;
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
      'Speaking content is managed by the Skill CMS /admin/skill-content/speaking',
    );
  }

  deleteSpeakingExercise(id: number) {
    void id;
    throw new ConflictException(
      'Speaking content is managed by the Skill CMS /admin/skill-content/speaking',
    );
  }

  // ============== PRACTICE TOPICS MANAGEMENT ==============
  async getPracticeTopics() {
    return this.prisma.practiceTopic.findMany({
      orderBy: { order: 'asc' },
      include: {
        _count: { select: { quizzes: true } },
      },
    });
  }

  async createPracticeTopic(dto: {
    name: string;
    vietnameseName?: string;
    category?: TopicCategory;
    iconUrl?: string;
    order?: number;
  }) {
    const category = dto.category ?? TopicCategory.BILINGUAL_LEVEL;
    if (!Object.values(TopicCategory).includes(category)) {
      throw new BadRequestException('Danh mục chủ đề luyện tập không hợp lệ');
    }
    return this.prisma.practiceTopic.create({
      data: {
        name: dto.name,
        vietnameseName: dto.vietnameseName,
        category,
        iconUrl: dto.iconUrl || 'target',
        order: dto.order || 1,
      },
    });
  }

  async deletePracticeTopic(id: number) {
    return this.prisma.practiceTopic.delete({ where: { id } });
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
      totalMaterials,
      totalUsers,
    ] = await Promise.all([
      this.prisma.speakingSubmission.count(),
      this.prisma.speakingSubmission.count({
        where: { submittedAt: { gte: startOfMonth } },
      }),
      this.prisma.speakingSubmission.count({
        where: { audioUrl: { contains: 'archived' } },
      }),
      this.prisma.material.count(),
      this.prisma.user.count(),
    ]);

    let cachedGeminiCount = 0;
    let geminiTotalRequests = 0;
    let geminiInputTokens = 0;
    let geminiOutputTokens = 0;
    let geminiCostUsd = 0;
    let geminiCostVnd = 0;

    if (this.redis) {
      try {
        const [keys, totalReqs, inTok, outTok] = await Promise.all([
          this.redis.keys('gemini:*'),
          this.redis.get('gemini:telemetry:total_requests'),
          this.redis.get('gemini:telemetry:input_tokens'),
          this.redis.get('gemini:telemetry:output_tokens'),
        ]);
        cachedGeminiCount = keys.length;
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

    let r2Usage: { totalMb: number } | null = null;
    try {
      r2Usage = await this.r2Service.getBucketStorageUsage();
    } catch {
      // R2 telemetry is unavailable; do not replace it with an estimate.
    }
    const activeAudioCount = Math.max(
      0,
      totalSpeakingSubmissions - archivedSpeakingAudio,
    );
    const measuredStorageMb = r2Usage?.totalMb ?? 0;
    const r2StorageGb = Number((measuredStorageMb / 1024).toFixed(3));

    return {
      summary: {
        totalCostUsd: 0,
        totalCostVnd: 0,
        savedCostUsd: 0,
        savedCostVnd: 0,
        status: 'UNAVAILABLE',
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
          audioMinutesThisMonth: 0,
          freeQuotaMinutes: 0,
          usedPercent: 0,
          costUsd: 0,
          costVnd: 0,
          withinFreeTier: false,
        },
        cloudflareR2: {
          name: 'Cloudflare R2 Object Storage',
          activeAudioFiles: activeAudioCount,
          archivedAudioFiles: archivedSpeakingAudio,
          totalMaterials,
          usedStorageMb: measuredStorageMb,
          usedStorageGb: r2StorageGb,
          freeQuotaGb: 0,
          usedPercent: 0,
          egressCostUsd: 0,
          costUsd: 0,
          costVnd: 0,
          withinFreeTier: false,
        },
      },
    };
  }

  async purgeAiCache() {
    if (!this.redis) {
      return { success: true, count: 0, message: 'Redis không được kết nối' };
    }
    const allKeys = await this.redis.keys('gemini:*');
    // Preserve operational telemetry keys and daily quota keys during cache purge
    const cacheKeys = allKeys.filter(
      (k) =>
        !k.startsWith('gemini:telemetry:') &&
        !k.startsWith('gemini:daily_quota:'),
    );
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
