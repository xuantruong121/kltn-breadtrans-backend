/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnrollmentStatus } from '@prisma/client';

@Injectable()
export class ClassService {
  constructor(private readonly prisma: PrismaService) {}

  async getClassDetail(classId: number, userId: number, role: string) {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        course: {
          include: {
            lessons: {
              include: {
                materials: true,
              },
            },
          },
        },
        assignments: {
          include: {
            submissions:
              role === 'STUDENT'
                ? {
                    where: { userId },
                  }
                : true,
          },
          orderBy: { createdAt: 'desc' },
        },
        enrollments: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                profile: { select: { fullName: true, avatar: true } },
              },
            },
          },
        },
      },
    });

    if (!cls) throw new NotFoundException('Không tìm thấy lớp học');

    // Kiểm tra phân quyền phạm vi truy cập (RBAC & Scope)
    if (role === 'STUDENT') {
      const isEnrolled = cls.enrollments.some(
        (e) =>
          (e.user?.id ?? (e as any).userId) === userId &&
          (e.status === 'ACTIVE' || e.status === 'COMPLETED'),
      );
      if (!isEnrolled) {
        throw new ForbiddenException(
          'Bạn chưa ghi danh hoặc không có quyền truy cập bài giảng và tài liệu của lớp học này',
        );
      }
      return {
        ...cls,
      };
    }

    return cls;
  }

  async getMyClasses(userId: number, _role: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        userId,
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      },
      include: {
        class: {
          include: {
            course: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return enrollments.map((enr) => ({
      ...enr.class,
      enrollmentProgress: enr.progress,
      enrollmentStatus: enr.status,
    }));
  }

  async getWatchTracking(userId: number) {
    const tracking = await this.prisma.watchTracking.findUnique({
      where: { userId },
    });
    return tracking?.items || {};
  }

  async updateWatchTracking(userId: number, videoKey: string, played: number) {
    if (
      typeof played !== 'number' ||
      isNaN(played) ||
      !isFinite(played) ||
      played < 0 ||
      played > 1
    ) {
      throw new BadRequestException(
        'Tỷ lệ xem video không hợp lệ (cần trong khoảng 0..1)',
      );
    }

    if (!videoKey || typeof videoKey !== 'string' || !videoKey.trim()) {
      throw new BadRequestException('videoKey không được để trống');
    }

    const trimmedKey = videoKey.trim();

    // 1. Verify video belongs to a Lesson in a Course
    const lesson = await this.prisma.lesson.findFirst({
      where: { videoUrl: trimmedKey },
      select: { id: true, courseId: true },
    });

    if (!lesson) {
      throw new NotFoundException(
        'Video không thuộc bài học nào trong hệ thống',
      );
    }

    // 2. Verify Student has an ACTIVE or COMPLETED Enrollment for this Course
    const activeEnrollments = await this.prisma.enrollment.findMany({
      where: {
        userId,
        class: { courseId: lesson.courseId },
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      },
      select: { id: true },
    });

    if (!activeEnrollments || activeEnrollments.length === 0) {
      throw new ForbiddenException(
        'Học viên chưa có gói học ACTIVE hoặc COMPLETED cho khóa học này',
      );
    }

    // 3. Monotonic update: storedPlayed = max(previousPlayed, incomingPlayed)
    const existing = await this.prisma.watchTracking.findUnique({
      where: { userId },
    });

    const currentItems = (existing?.items as Record<string, any>) || {};
    const prevPlayed =
      typeof currentItems[trimmedKey]?.played === 'number'
        ? currentItems[trimmedKey].played
        : 0;
    const storedPlayed = Math.max(prevPlayed, played);

    currentItems[trimmedKey] = {
      played: storedPlayed,
      updatedAt: new Date().toISOString(),
    };

    await this.prisma.watchTracking.upsert({
      where: { userId },
      update: { items: currentItems },
      create: { userId, items: currentItems },
    });

    // 4. Calculate content progress from server-known trackable video Lessons
    const allLessons = await this.prisma.lesson.findMany({
      where: {
        courseId: lesson.courseId,
        videoUrl: { not: null },
      },
      select: { videoUrl: true },
    });

    const trackableLessons = allLessons.filter(
      (l) => l.videoUrl && l.videoUrl.trim() !== '',
    );

    let calculatedProgress = 0;
    if (trackableLessons.length > 0) {
      let completedCount = 0;
      trackableLessons.forEach((l) => {
        const item = currentItems[l.videoUrl!];
        if (item && typeof item.played === 'number' && item.played >= 0.9) {
          completedCount++;
        }
      });
      calculatedProgress = Math.round(
        (completedCount / trackableLessons.length) * 100,
      );
    }

    // 5. Update all relevant ACTIVE/COMPLETED Enrollment rows and AWAIT write
    await this.prisma.enrollment.updateMany({
      where: {
        userId,
        class: { courseId: lesson.courseId },
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      },
      data: { progress: calculatedProgress },
    });

    return {
      success: true,
      videoKey: trimmedKey,
      played: storedPlayed,
      progress: calculatedProgress,
    };
  }
}
