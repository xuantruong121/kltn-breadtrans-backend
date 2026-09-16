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
  EnrollmentStatus,
  PaymentStatus,
  TopicCategory,
} from '@prisma/client';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { R2Service } from '../upload/r2.service';
import { R2CleanupService } from '../upload/r2-cleanup.service';
import * as bcrypt from 'bcrypt';
import { CourseService } from '../course/course.service';

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
      },
      monthlyTrends,
      contentBreakdown,
      gamification,
      recentActivity,
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
      ].filter((value): value is Date => value instanceof Date);

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

  async createUser(dto: {
    email: string;
    password: string;
    role: Role;
    fullName: string;
    phone?: string;
  }) {
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

  async updateUser(
    userId: number,
    dto: {
      fullName?: string;
      phone?: string;
      role?: Role;
      password?: string;
    },
  ) {
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
        'Không thể xóa quyền truy cập vì tồn tại lịch sử thanh toán cần được lưu giữ.',
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

  // ============== VOCAB MANAGEMENT ==============
  async getVocabTopics() {
    return this.prisma.vocabTopic.findMany({
      include: {
        _count: { select: { words: true } },
      },
      orderBy: { id: 'asc' },
    });
  }

  async createVocabTopic(dto: {
    title: string;
    categoryName?: string;
    isPro?: boolean;
  }) {
    return this.prisma.vocabTopic.create({
      data: {
        title: dto.title,
        categoryName: dto.categoryName || '600 TỪ VỰNG TOEIC',
        isPro: dto.isPro || false,
      },
    });
  }

  async deleteVocabTopic(id: number) {
    return this.prisma.vocabTopic.delete({ where: { id } });
  }

  async addVocabWord(topicId: number, dto: any) {
    return this.prisma.vocabWord.create({
      data: {
        topicId,
        word: dto.word,
        pos: dto.pos || 'noun',
        ipaUs: dto.ipaUs,
        ipaUk: dto.ipaUk,
        meaning: dto.meaning,
        exampleEn: dto.exampleEn,
        exampleVi: dto.exampleVi,
      },
    });
  }

  async deleteVocabWord(id: number) {
    return this.prisma.vocabWord.delete({ where: { id } });
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

  async createSpeakingExercise(dto: {
    title: string;
    targetText: string;
    category?: string;
    difficulty?: string;
  }) {
    return this.prisma.speakingExercise.create({
      data: {
        title: dto.title,
        targetText: dto.targetText,
        category: dto.category || 'COMMUNICATION',
        difficulty: dto.difficulty || 'BEGINNER',
      },
    });
  }

  async deleteSpeakingExercise(id: number) {
    return this.prisma.speakingExercise.delete({ where: { id } });
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
    if (this.redis) {
      try {
        const keys = await this.redis.keys('gemini:*');
        cachedGeminiCount = keys.length;
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
          model: process.env.GEMINI_MODEL_NAME || 'gemini-3.1-flash-lite',
          totalRequests: 0,
          cachedEntries: cachedGeminiCount,
          cacheHitCount: 0,
          cacheHitRate: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          costVnd: 0,
          freeTierStatus: 'Chưa kết nối dữ liệu billing',
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
    const keys = await this.redis.keys('gemini:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    return {
      success: true,
      count: keys.length,
      message: `Đã xóa thành công ${keys.length} mục cache của Gemini AI`,
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
