import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Role,
  TopicCategory,
  QuizPublicationStatus,
  QuizType,
} from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateShippingProfileDto } from './dto/update-shipping-profile.dto';
import { ReadingService } from '../reading/reading.service';
import { LocationService } from '../location/location.service';
import {
  normalizeVietnamPhone,
  isValidVietnamPhone,
} from '../../common/utils/vietnam-phone.util';
import {
  CrossSkillSummaryResponse,
  CrossSkillSummaryItem,
  SkillDimensionSummary,
  SkillStatus,
  SkillTrend,
  UserSkillsSummaryResponse,
} from './dto/user-skills-summary.dto';
import { resolveSpeakingPracticeSet } from '../speaking/speaking-practice-set';

const CROSS_SKILL_SAMPLE_SIZE = 3;

type ScoreAttempt = { score: number; submittedAt: Date };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSpeakingScore(value: unknown): number | null {
  const score = finiteNumber(value);
  if (score === null) return null;
  return clampScore(score <= 10 ? score * 10 : score);
}

function normalizedWritingScore(
  score: unknown,
  maxScore: unknown,
): number | null {
  const raw = finiteNumber(score);
  const max = finiteNumber(maxScore);
  if (raw === null || max === null || max <= 0) return null;
  return clampScore((raw / max) * 100);
}

function skillStatus(sampleCount: number, score: number | null): SkillStatus {
  if (sampleCount < CROSS_SKILL_SAMPLE_SIZE || score === null) {
    return 'INSUFFICIENT_DATA';
  }
  if (score < 50) return 'NEEDS_IMPROVEMENT';
  if (score < 75) return 'PROGRESSING';
  return 'GOOD';
}

function statusLabel(status: SkillStatus): string {
  switch (status) {
    case 'NEEDS_IMPROVEMENT':
      return 'Cần cải thiện';
    case 'PROGRESSING':
      return 'Đang tiến bộ';
    case 'GOOD':
      return 'Tốt';
    default:
      return 'Chưa đủ dữ liệu';
  }
}

function asSkillTrend(value: unknown): SkillTrend {
  return value === 'IMPROVING' ||
    value === 'DECLINING' ||
    value === 'STABLE' ||
    value === 'INSUFFICIENT_DATA'
    ? value
    : 'INSUFFICIENT_DATA';
}

function trendFor(attempts: ScoreAttempt[]): {
  trend: SkillTrend;
  delta: number | null;
} {
  if (attempts.length < 2) return { trend: 'INSUFFICIENT_DATA', delta: null };
  const previous = attempts.at(-2)?.score;
  const latest = attempts.at(-1)?.score;
  if (previous === undefined || latest === undefined) {
    return { trend: 'INSUFFICIENT_DATA', delta: null };
  }
  const delta = latest - previous;
  return {
    delta,
    trend: delta > 0 ? 'IMPROVING' : delta < 0 ? 'DECLINING' : 'STABLE',
  };
}

function average(values: number[]): number | null {
  return values.length > 0
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

function dimensionStatus(sampleCount: number, score: number | null) {
  const status = skillStatus(sampleCount, score);
  return { status, statusLabel: statusLabel(status) };
}

function summarizeDimensions(dimensions: Map<string, { scores: number[] }>): {
  items: SkillDimensionSummary[];
  strongest: string | null;
  weakest: string | null;
} {
  const items = [...dimensions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const averageScore = average(value.scores);
      const status = dimensionStatus(value.scores.length, averageScore);
      return {
        key,
        sampleCount: value.scores.length,
        averageScore,
        ...status,
      };
    });
  const eligible = items.filter(
    (item) =>
      item.sampleCount >= CROSS_SKILL_SAMPLE_SIZE && item.averageScore !== null,
  );
  const strongest =
    [...eligible].sort(
      (a, b) =>
        (b.averageScore ?? 0) - (a.averageScore ?? 0) ||
        a.key.localeCompare(b.key),
    )[0]?.key ?? null;
  const weakest =
    [...eligible].sort(
      (a, b) =>
        (a.averageScore ?? 0) - (b.averageScore ?? 0) ||
        a.key.localeCompare(b.key),
    )[0]?.key ?? null;
  return { items, strongest, weakest };
}

function buildSkillItem(
  base: Omit<
    CrossSkillSummaryItem,
    | 'completedAttempts'
    | 'normalizedScore'
    | 'recentAverage'
    | 'trend'
    | 'strongestDimension'
    | 'weakestDimension'
    | 'lastPracticedAt'
    | 'status'
    | 'statusLabel'
    | 'hasEnoughData'
    | 'dimensions'
  >,
  attempts: ScoreAttempt[],
  dimensions: Map<string, { scores: number[] }>,
  completedAttemptsOverride?: number,
  completedItemsOverride?: number,
): CrossSkillSummaryItem {
  const latestScores = attempts.slice(-5).map((attempt) => attempt.score);
  const normalizedScore = average(attempts.map((attempt) => attempt.score));
  const recentAverage = average(latestScores);
  const trend = trendFor(attempts);
  const dimensionSummary = summarizeDimensions(dimensions);
  const status = skillStatus(attempts.length, normalizedScore);
  return {
    ...base,
    completedItems: completedItemsOverride ?? attempts.length,
    completedAttempts: completedAttemptsOverride ?? attempts.length,
    normalizedScore,
    recentAverage,
    trend: trend.trend,
    strongestDimension: dimensionSummary.strongest,
    weakestDimension: dimensionSummary.weakest,
    lastPracticedAt: attempts.at(-1)?.submittedAt.toISOString() ?? null,
    status,
    statusLabel: statusLabel(status),
    hasEnoughData: status !== 'INSUFFICIENT_DATA',
    dimensions: dimensionSummary.items,
  };
}

function buildFormattedAddress(
  addressLine: string,
  wardName: string,
  provinceName: string,
): string {
  const parts = [addressLine, wardName, provinceName, 'Việt Nam'].filter(
    (p) => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.join(', ');
}

function isShippingProfileComplete(
  profile:
    | {
        recipientName?: string | null;
        phone?: string | null;
        provinceCode?: string | null;
        wardCode?: string | null;
        addressLine?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!profile) return false;
  return Boolean(
    profile.recipientName?.trim() &&
      profile.phone?.trim() &&
      isValidVietnamPhone(profile.phone) &&
      profile.provinceCode?.trim() &&
      profile.wardCode?.trim() &&
      profile.addressLine?.trim(),
  );
}

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly readingService?: ReadingService,
    @Optional() private readonly locationService?: LocationService,
  ) {}

  async getUserProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        stats: true,
        leaderboard: true,
        pet: true,
        billing: true,
        shippingProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, refreshToken, ...userWithoutSensitiveData } = user;
    const shippingComplete = isShippingProfileComplete(user.shippingProfile);
    const formattedAddress = user.shippingProfile
      ? buildFormattedAddress(
          user.shippingProfile.addressLine,
          user.shippingProfile.wardName,
          user.shippingProfile.provinceName,
        )
      : '';

    return {
      ...userWithoutSensitiveData,
      shippingProfileComplete: shippingComplete,
      shippingProfile: user.shippingProfile
        ? {
            ...user.shippingProfile,
            formattedAddress,
            shippingProfileComplete: shippingComplete,
          }
        : null,
    };
  }

  async getShippingProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        shippingProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.shippingProfile) {
      const isComplete = isShippingProfileComplete(user.shippingProfile);
      const phoneNorm = normalizeVietnamPhone(user.shippingProfile.phone);
      return {
        ...user.shippingProfile,
        phoneDisplay: phoneNorm?.display || user.shippingProfile.phone,
        formattedAddress: buildFormattedAddress(
          user.shippingProfile.addressLine,
          user.shippingProfile.wardName,
          user.shippingProfile.provinceName,
        ),
        shippingProfileComplete: isComplete,
      };
    }

    const defaultRecipient = user.profile?.fullName || '';
    const phoneNorm = user.profile?.phone
      ? normalizeVietnamPhone(user.profile.phone)
      : null;

    return {
      recipientName: defaultRecipient,
      phone: phoneNorm?.e164 || user.profile?.phone || '',
      phoneDisplay: phoneNorm?.display || user.profile?.phone || '',
      countryCode: 'VN',
      provinceCode: '',
      provinceName: '',
      wardCode: '',
      wardName: '',
      addressLine: '',
      formattedAddress: '',
      shippingProfileComplete: false,
    };
  }

  async updateShippingProfile(userId: number, dto: UpdateShippingProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const normPhone = normalizeVietnamPhone(dto.phone);
    if (!normPhone) {
      throw new BadRequestException({
        code: 'INVALID_VIETNAM_PHONE',
        message:
          'Số điện thoại không hợp lệ. Vui lòng nhập số di động Việt Nam hợp lệ (ví dụ: 0987654321 hoặc +84987654321).',
      });
    }

    if (!this.locationService) {
      throw new BadRequestException(
        'Dịch vụ tra cứu đơn vị hành chính tạm thời không khả dụng',
      );
    }

    const validation = await this.locationService.validateWardBelongsToProvince(
      dto.provinceCode,
      dto.wardCode,
    );

    if (!validation.valid) {
      if (!validation.provinceName) {
        throw new BadRequestException({
          code: 'INVALID_PROVINCE',
          message:
            'Mã tỉnh/thành phố không hợp lệ trong danh mục hành chính Việt Nam',
        });
      }
      throw new BadRequestException({
        code: 'WARD_PROVINCE_MISMATCH',
        message: 'Phường/xã đã chọn không thuộc tỉnh/thành phố tương ứng',
      });
    }

    const provinceName = validation.provinceName!;
    const wardName = validation.wardName!;
    const addressLine = dto.addressLine.trim();
    const recipientName = dto.recipientName.trim();

    const saved = await this.prisma.userShippingProfile.upsert({
      where: { userId },
      update: {
        recipientName,
        phone: normPhone.e164,
        countryCode: 'VN',
        provinceCode: dto.provinceCode.trim(),
        provinceName,
        wardCode: dto.wardCode.trim(),
        wardName,
        addressLine,
      },
      create: {
        userId,
        recipientName,
        phone: normPhone.e164,
        countryCode: 'VN',
        provinceCode: dto.provinceCode.trim(),
        provinceName,
        wardCode: dto.wardCode.trim(),
        wardName,
        addressLine,
      },
    });

    if (!user.profile?.phone) {
      await this.prisma.profile.updateMany({
        where: { userId },
        data: { phone: normPhone.e164 },
      });
    }

    const formattedAddress = buildFormattedAddress(
      addressLine,
      wardName,
      provinceName,
    );

    return {
      ...saved,
      phoneDisplay: normPhone.display,
      formattedAddress,
      shippingProfileComplete: true,
    };
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
      totalToeicTestsDone: toeicCount,
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
        where: {
          type: QuizType.BILINGUAL_READING,
          publicationStatus: QuizPublicationStatus.PUBLISHED,
          practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL },
          questions: { some: {} },
        },
        select: { id: true },
      }),
      this.prisma.submission.findMany({
        where: {
          userId,
          quiz: {
            type: QuizType.BILINGUAL_READING,
            publicationStatus: QuizPublicationStatus.PUBLISHED,
            practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL },
            questions: { some: {} },
          },
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

  /**
   * Cross-skill read projection. Each skill keeps its own durable source;
   * this method only normalizes the learner-facing contract to 0..100.
   */
  async getSkillProgressSummary(
    userId: number,
    role: Role = Role.STUDENT,
  ): Promise<CrossSkillSummaryResponse> {
    const [
      listeningSubmissions,
      speakingSubmissions,
      writingSubmissions,
      stats,
    ] = await Promise.all([
      this.prisma.submission.findMany({
        where: { userId, quiz: { type: QuizType.LISTENING_PRACTICE } },
        orderBy: { submittedAt: 'asc' },
        include: {
          quiz: {
            select: {
              id: true,
              title: true,
              questions: {
                select: { id: true, type: true, content: true },
                orderBy: { order: 'asc' },
              },
            },
          },
          results: true,
        },
      }),
      this.prisma.speakingSubmission.findMany({
        where: { userId, status: 'COMPLETED' },
        orderBy: { submittedAt: 'asc' },
        select: {
          id: true,
          exerciseId: true,
          overallScore: true,
          aiFeedback: true,
          submittedAt: true,
        },
      }),
      this.prisma.submission.findMany({
        where: {
          userId,
          quiz: {
            type: { in: [QuizType.WRITING_PICTURE, QuizType.WRITING_EMAIL] },
            practiceTopic: {
              category: {
                in: [TopicCategory.WRITING_PART1, TopicCategory.WRITING_PART2],
              },
            },
          },
        },
        orderBy: { submittedAt: 'asc' },
        include: {
          quiz: {
            select: {
              type: true,
              questions: {
                select: { content: true },
                orderBy: { order: 'asc' },
                take: 1,
              },
            },
          },
          results: { select: { score: true } },
        },
      }),
      this.prisma.userStats.findUnique({ where: { userId } }),
    ]);

    const readingTracking = this.readingService
      ? await this.readingService.getTracking(userId, role)
      : null;
    const countQuizSafely = async (where: any) => {
      try {
        if (typeof this.prisma.quiz?.count === 'function') {
          const c = await this.prisma.quiz.count({ where });
          return Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 0;
        }
      } catch {
        // Safe fallback
      }
      return 0;
    };

    const speakingRowsRaw =
      typeof this.prisma.speakingExercise.findMany === 'function'
        ? await this.prisma.speakingExercise.findMany({
            where: { title: { not: '' }, targetText: { not: '' } },
            select: {
              id: true,
              title: true,
              category: true,
              practiceSet: {
                select: { id: true, title: true, description: true },
              },
            },
          })
        : [];
    const speakingRows = Array.isArray(speakingRowsRaw) ? speakingRowsRaw : [];
    const speakingSets = new Map<string, number[]>();
    for (const row of speakingRows) {
      const set = row.practiceSet ?? resolveSpeakingPracticeSet(row);
      const key = 'id' in set ? set.id : set.key;
      speakingSets.set(key, [...(speakingSets.get(key) ?? []), row.id]);
    }
    const speakingCatalogCountRaw =
      speakingRows.length > 0
        ? speakingSets.size
        : await this.prisma.speakingExercise.count({
            where: {
              title: { not: '' },
              targetText: { not: '' },
            },
          });
    const speakingCatalogCount = Number.isFinite(speakingCatalogCountRaw)
      ? Math.max(0, Math.floor(speakingCatalogCountRaw))
      : 0;

    const [listeningCatalogCount, readingCatalogCount, writingCatalogCount] =
      await Promise.all([
        countQuizSafely({ type: QuizType.LISTENING_PRACTICE }),
        countQuizSafely({
          type: QuizType.BILINGUAL_READING,
          publicationStatus: QuizPublicationStatus.PUBLISHED,
          practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL },
          questions: { some: {} },
        }),
        countQuizSafely({
          type: { in: [QuizType.WRITING_PICTURE, QuizType.WRITING_EMAIL] },
          practiceTopic: {
            category: {
              in: [TopicCategory.WRITING_PART1, TopicCategory.WRITING_PART2],
            },
          },
        }),
      ]);

    const listeningAttempts: ScoreAttempt[] = [];
    const listeningDimensions = new Map<string, { scores: number[] }>();
    for (const submission of listeningSubmissions) {
      const questionIds = submission.quiz.questions.map(
        (question) => question.id,
      );
      const resultIds = submission.results.map((result) => result.questionId);
      if (
        questionIds.length === 0 ||
        resultIds.length !== questionIds.length ||
        new Set(resultIds).size !== questionIds.length ||
        !questionIds.every((id) => resultIds.includes(id))
      ) {
        continue;
      }
      const resultsByQuestion = new Map(
        submission.results.map((result) => [result.questionId, result]),
      );
      let correct = 0;
      for (const question of submission.quiz.questions) {
        const result = resultsByQuestion.get(question.id);
        if (!result) continue;
        if (result.isCorrect === true) correct += 1;
        const content = asRecord(question.content);
        const declared = String(
          content.questionType ?? content.category ?? '',
        ).trim();
        const dimension =
          question.type === 'DICTATION' || question.type === 'FILL_IN_BLANK'
            ? 'DICTATION'
            : question.type === 'MULTIPLE_CHOICE'
              ? declared && declared !== 'READING'
                ? declared.toUpperCase()
                : 'MULTIPLE_CHOICE'
              : declared
                ? declared.toUpperCase()
                : question.type.toUpperCase();
        const bucket = listeningDimensions.get(dimension) ?? { scores: [] };
        bucket.scores.push(result.isCorrect === true ? 100 : 0);
        listeningDimensions.set(dimension, bucket);
      }
      listeningAttempts.push({
        score: clampScore((correct / questionIds.length) * 100),
        submittedAt: submission.submittedAt,
      });
    }

    const speakingAttempts: ScoreAttempt[] = [];
    const completedSpeakingExerciseIds = new Set(
      speakingSubmissions.map((submission) => submission.exerciseId),
    );
    const speakingDimensions = new Map<string, { scores: number[] }>();
    const speakingDimensionKeys = [
      'accuracyScore',
      'fluencyScore',
      'completenessScore',
      'prosodyScore',
      'pronunciationScore',
    ];
    for (const submission of speakingSubmissions) {
      const normalized = normalizeSpeakingScore(submission.overallScore);
      if (normalized !== null) {
        speakingAttempts.push({
          score: normalized,
          submittedAt: submission.submittedAt,
        });
      }
      const feedback = asRecord(submission.aiFeedback);
      for (const key of speakingDimensionKeys) {
        const dimensionScore = normalizeSpeakingScore(feedback[key]);
        if (dimensionScore === null) continue;
        const bucket = speakingDimensions.get(key) ?? { scores: [] };
        bucket.scores.push(dimensionScore);
        speakingDimensions.set(key, bucket);
      }
    }

    const writingAttempts: ScoreAttempt[] = [];
    for (const submission of writingSubmissions) {
      const content = asRecord(submission.quiz.questions[0]?.content);
      const feedback = asRecord(
        submission.aiFeedback ? safeJson(submission.aiFeedback) : null,
      );
      const taskType = String(content.taskType ?? '').toUpperCase();
      const maxScore =
        finiteNumber(feedback.maxScore) ??
        ([
          'PROPOSAL',
          'OPINION',
          'ESSAY',
          'OPINION_ESSAY',
          'ANALYTICAL_RESPONSE',
          'ARGUMENT',
        ].includes(taskType)
          ? 5
          : submission.quiz.type === QuizType.WRITING_PICTURE &&
              content.imageUrl
            ? 3
            : 4);
      const rawScore = submission.score ?? submission.results[0]?.score;
      const normalized = normalizedWritingScore(rawScore, maxScore);
      if (normalized !== null) {
        writingAttempts.push({
          score: normalized,
          submittedAt: submission.submittedAt,
        });
      }
    }

    const readingDimensions = new Map<string, { scores: number[] }>();
    for (const metric of readingTracking?.subskills ?? []) {
      if (metric.attempted > 0) {
        readingDimensions.set(metric.key, {
          scores: Array.from(
            { length: metric.attempted },
            () => metric.accuracy,
          ),
        });
      }
    }
    const readingAttempts: ScoreAttempt[] = (
      readingTracking?.recentTrend.attempts ?? []
    )
      .slice()
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      .map((attempt) => ({
        score: attempt.accuracy,
        submittedAt: new Date(attempt.submittedAt),
      }));

    const completedListeningQuizIds = new Set(
      listeningSubmissions.map((s) => s.quiz.id),
    );
    const completedWritingQuizIds = new Set(
      writingSubmissions.map((s) => s.quizId),
    );
    const listeningCompletedItems = completedListeningQuizIds.size;
    const listeningCompletedAttempts = listeningSubmissions.length;
    const speakingCompletedItems =
      speakingRows.length > 0
        ? [...speakingSets.values()].filter((exerciseIds) =>
            exerciseIds.every((id) => completedSpeakingExerciseIds.has(id)),
          ).length
        : completedSpeakingExerciseIds.size;
    const speakingCompletedAttempts = speakingSubmissions.length;
    const readingCompletedItems =
      readingTracking?.progress.completedExercises ?? 0;
    const readingCompletedAttempts =
      readingTracking?.progress.completedAttempts ?? 0;
    const writingCompletedItems = completedWritingQuizIds.size;
    const writingCompletedAttempts = writingAttempts.length;

    const calcPercent = (completed: number, total: number) =>
      total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

    const base = {
      LISTENING: {
        skill: 'LISTENING' as const,
        title: 'Listening',
        categoryLabel: 'Nghe hiểu',
        totalItems: listeningCatalogCount,
        completedItems: listeningCompletedItems,
        progressPercent: calcPercent(
          listeningCompletedItems,
          listeningCatalogCount,
        ),
        levelRange: 'A1 - C1',
        badge: 'Nghe chủ động',
        unitLabel: 'bài',
      },
      SPEAKING: {
        skill: 'SPEAKING' as const,
        title: 'Speaking',
        categoryLabel: 'Nói và phát âm',
        totalItems: speakingCatalogCount,
        completedItems: speakingCompletedItems,
        progressPercent: calcPercent(
          speakingCompletedItems,
          speakingCatalogCount,
        ),
        levelRange: 'A1 - C1',
        badge: 'Phản hồi phát âm',
        unitLabel: 'bài luyện',
        ...(speakingRows.length > 0
          ? {
              totalExercises: speakingRows.length,
              completedExercises: completedSpeakingExerciseIds.size,
            }
          : {}),
      },
      READING: {
        skill: 'READING' as const,
        title: 'Reading',
        categoryLabel: 'Đọc hiểu',
        totalItems: readingCatalogCount,
        completedItems: readingCompletedItems,
        progressPercent: calcPercent(
          readingCompletedItems,
          readingCatalogCount,
        ),
        levelRange: 'A1 - C1',
        badge: 'Phân tích kỹ năng',
        unitLabel: 'bài',
      },
      WRITING: {
        skill: 'WRITING' as const,
        title: 'Writing',
        categoryLabel: 'Viết và diễn đạt',
        totalItems: writingCatalogCount,
        completedItems: writingCompletedItems,
        progressPercent: calcPercent(
          writingCompletedItems,
          writingCatalogCount,
        ),
        levelRange: 'A1 - C1',
        badge: 'AI phản hồi',
        unitLabel: 'đề bài',
      },
    };

    const readingSkill = buildSkillItem(
      base.READING,
      readingAttempts,
      readingDimensions,
      readingCompletedAttempts,
      readingCompletedItems,
    );
    if (readingTracking?.progress.completedAttempts) {
      readingSkill.normalizedScore = readingTracking.progress.accuracy;
      readingSkill.recentAverage = readingTracking.progress.recentAverage;
      readingSkill.lastPracticedAt = readingTracking.progress.lastPracticedAt;
      readingSkill.status = skillStatus(
        readingTracking.progress.completedAttempts,
        readingTracking.progress.accuracy,
      );
      readingSkill.statusLabel = statusLabel(readingSkill.status);
      readingSkill.hasEnoughData = readingSkill.status !== 'INSUFFICIENT_DATA';
      readingSkill.trend = asSkillTrend(readingTracking.recentTrend.direction);
    }
    const skills = [
      buildSkillItem(
        base.LISTENING,
        listeningAttempts,
        listeningDimensions,
        listeningCompletedAttempts,
        listeningCompletedItems,
      ),
      buildSkillItem(
        base.SPEAKING,
        speakingAttempts,
        speakingDimensions,
        speakingCompletedAttempts,
        speakingCompletedItems,
      ),
      readingSkill,
      buildSkillItem(
        base.WRITING,
        writingAttempts,
        new Map(),
        writingCompletedAttempts,
        writingCompletedItems,
      ),
    ];
    const scoreValues = skills
      .map((skill) => skill.normalizedScore)
      .filter((score): score is number => score !== null);
    const recentValues = skills
      .map((skill) => skill.recentAverage)
      .filter((score): score is number => score !== null);
    const overallTotalItems = skills.reduce(
      (sum, skill) => sum + skill.totalItems,
      0,
    );
    const overallCompletedItems = skills.reduce(
      (sum, skill) => sum + skill.completedItems,
      0,
    );
    const overallScore = average(scoreValues);
    const overallRecent = average(recentValues);
    const overallTrendAttempts = [
      ...listeningAttempts,
      ...speakingAttempts,
      ...readingAttempts,
      ...writingAttempts,
    ];
    const overallTrend = trendFor(
      overallTrendAttempts.sort(
        (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
      ),
    );

    return {
      skills,
      overall: {
        totalItems: overallTotalItems,
        completedItems: overallCompletedItems,
        progressPercent: calcPercent(overallCompletedItems, overallTotalItems),
        normalizedScore: overallScore,
        recentAverage: overallRecent,
        trend: overallTrend.trend,
        currentStreak: stats?.streakCount ?? 0,
      },
    };
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
