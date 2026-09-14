import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TopicCategory, QuizType } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserSkillsSummaryResponse } from './dto/user-skills-summary.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        stats: true,
        leaderboard: true,
        pet: true,
        billing: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, refreshToken, ...userWithoutSensitiveData } = user;
    return userWithoutSensitiveData;
  }

  async updateUserProfile(userId: number, updateData: UpdateProfileDto) {
    // Upsert profile in case it doesn't exist
    return this.prisma.profile.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        fullName: updateData.fullName || 'User',
        ...updateData,
      },
    });
  }

  async getUserStats(userId: number) {
    const [
      stats,
      leaderboard,
      pet,
      vocabProgress,
      submissionsCount,
      toeicCount,
      diagnosticAttempt,
    ] = await Promise.all([
      this.prisma.userStats.findUnique({ where: { userId } }),
      this.prisma.leaderboard.findUnique({ where: { userId } }),
      this.prisma.userPet.findUnique({ where: { userId } }),
      this.prisma.userVocabWordProgress.count({
        where: { userId, isMastered: true },
      }),
      this.prisma.submission.count({ where: { userId } }),
      this.prisma.toeicAttempt.count({
        where: { userId, submittedAt: { not: null } },
      }),
      this.prisma.diagnosticAttempt.findFirst({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    return {
      streakCount: stats?.streakCount || 0,
      streakFreezes: stats?.streakFreezes || 0,
      totalBanhRan: stats?.totalBanhRan || 0,
      quizAccuracy: stats?.quizAccuracy || 0,
      speakingAccuracy: stats?.speakingAccuracy || 0,
      totalPoints: leaderboard?.totalPoints || 0,
      weeklyExp: leaderboard?.weeklyExp || 0,
      tier: leaderboard?.tier || 'Đồng',
      masteredVocabCount: vocabProgress,
      totalQuizzesDone: submissionsCount + toeicCount,
      pet: pet || null,
      hasCompletedPlacementTest: !!diagnosticAttempt,
      latestDiagnostic: diagnosticAttempt
        ? {
            level: diagnosticAttempt.level,
            percentage: diagnosticAttempt.percentage,
            submittedAt: diagnosticAttempt.submittedAt,
          }
        : null,
    };
  }

  async getLearningHistory(userId: number, type?: string, requestedLimit = 50) {
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const activities = await this.prisma.learningActivity.findMany({
      where: { userId, ...(type && type !== 'ALL' ? { type } : {}) },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    const summary = await this.prisma.learningActivity.groupBy({
      by: ['type'],
      where: { userId },
      _count: { _all: true },
      _avg: { score: true },
    });
    const [stats, diagnostic] = await Promise.all([
      this.prisma.userStats.findUnique({ where: { userId } }),
      this.prisma.diagnosticAttempt.findFirst({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);
    return {
      activities,
      summary: {
        completedCount: activities.length,
        streakCount: stats?.streakCount || 0,
        latestDiagnostic: diagnostic
          ? {
              level: diagnostic.level,
              percentage: diagnostic.percentage,
              submittedAt: diagnostic.submittedAt,
            }
          : null,
        byType: summary.map((item) => ({
          type: item.type,
          count: item._count._all,
          averageScore: item._avg.score,
        })),
      },
    };
  }

  async getUserSkillsSummary(
    userId: number,
  ): Promise<UserSkillsSummaryResponse> {
    const [
      listeningQuizzes,
      listeningSubmissions,
      readingQuizzes,
      readingSubmissions,
      speakingCount,
      speakingSubmissions,
      writingQuizzes,
      writingSubmissions,
    ] = await Promise.all([
      // 1. Listening (QuizType.LISTENING_PRACTICE)
      this.prisma.quiz.findMany({
        where: { type: QuizType.LISTENING_PRACTICE },
        select: { id: true },
      }),
      this.prisma.submission.findMany({
        where: {
          userId,
          quiz: { type: QuizType.LISTENING_PRACTICE },
        },
        select: { quizId: true },
        distinct: ['quizId'],
      }),

      // 2. Reading (TopicCategory.BILINGUAL_LEVEL)
      this.prisma.quiz.findMany({
        where: { practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL } },
        select: { id: true },
      }),
      this.prisma.submission.findMany({
        where: {
          userId,
          quiz: { practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL } },
        },
        select: { quizId: true },
        distinct: ['quizId'],
      }),

      // 3. Speaking (SpeakingExercise & SpeakingSubmission)
      this.prisma.speakingExercise.count(),
      this.prisma.speakingSubmission.findMany({
        where: { userId, status: 'COMPLETED' },
        select: { exerciseId: true },
        distinct: ['exerciseId'],
      }),

      // 4. Writing (TopicCategory.WRITING_PART1)
      this.prisma.quiz.findMany({
        where: { practiceTopic: { category: TopicCategory.WRITING_PART1 } },
        select: { id: true },
      }),
      this.prisma.submission.findMany({
        where: {
          userId,
          quiz: { practiceTopic: { category: TopicCategory.WRITING_PART1 } },
        },
        select: { quizId: true },
        distinct: ['quizId'],
      }),
    ]);

    const calcPercent = (completed: number, total: number) =>
      total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

    return {
      skills: [
        {
          skill: 'LISTENING',
          title: 'Listening Studio',
          categoryLabel: 'Part 1 – Part 4',
          totalItems: listeningQuizzes.length,
          completedItems: listeningSubmissions.length,
          progressPercent: calcPercent(
            listeningSubmissions.length,
            listeningQuizzes.length,
          ),
          levelRange: 'B1 - C1',
          badge: 'Tốc độ 1.0x–1.5x',
          unitLabel: 'Bài luyện',
        },
        {
          skill: 'READING',
          title: 'Reading Mastery',
          categoryLabel: 'Part 5 – Part 7',
          totalItems: readingQuizzes.length,
          completedItems: readingSubmissions.length,
          progressPercent: calcPercent(
            readingSubmissions.length,
            readingQuizzes.length,
          ),
          levelRange: 'A2 - C1',
          badge: 'Dịch song ngữ',
          unitLabel: 'Bài đọc',
        },
        {
          skill: 'SPEAKING',
          title: 'Speaking AI Lab',
          categoryLabel: 'Azure AI Speech',
          totalItems: speakingCount,
          completedItems: speakingSubmissions.length,
          progressPercent: calcPercent(
            speakingSubmissions.length,
            speakingCount,
          ),
          levelRange: 'B1 - C1',
          badge: 'Chấm IPA tức thì',
          unitLabel: 'Tình huống',
        },
        {
          skill: 'WRITING',
          title: 'Writing AI Tutor',
          categoryLabel: 'Structured AI',
          totalItems: writingQuizzes.length,
          completedItems: writingSubmissions.length,
          progressPercent: calcPercent(
            writingSubmissions.length,
            writingQuizzes.length,
          ),
          levelRange: 'B1 - C1',
          badge: 'Góp ý từng câu',
          unitLabel: 'Đề bài',
        },
      ],
      overall: {
        totalItems:
          listeningQuizzes.length +
          readingQuizzes.length +
          speakingCount +
          writingQuizzes.length,
        completedItems:
          listeningSubmissions.length +
          readingSubmissions.length +
          speakingSubmissions.length +
          writingSubmissions.length,
        progressPercent: calcPercent(
          listeningSubmissions.length +
            readingSubmissions.length +
            speakingSubmissions.length +
            writingSubmissions.length,
          listeningQuizzes.length +
            readingQuizzes.length +
            speakingCount +
            writingQuizzes.length,
        ),
      },
    };
  }
}
