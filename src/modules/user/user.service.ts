import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
}
