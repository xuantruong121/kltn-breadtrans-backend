import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

import { EventsGateway } from '../events/events.gateway';

export interface CreateSessionDto {
  title?: string;
  startTime?: string | Date;
  endTime?: string | Date;
  meetingLink?: string;
}

@Injectable()
export class ClassService {
  private readonly logger = new Logger(ClassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async createDailyRoom(
    requestedName?: string,
    endTime?: string | Date,
  ): Promise<string> {
    const apiKey = process.env.DAILY_API_KEY;
    const domain = process.env.DAILY_DOMAIN || 'breadtrans-kltn.daily.co';

    // Normalize room name for Daily (lowercase alphanumeric & hyphens only)
    const cleanName = (requestedName || `room-${Date.now()}`)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 38);

    const fallbackUrl = `https://${domain}/${cleanName}`;

    if (!apiKey) {
      this.logger.warn('DAILY_API_KEY not configured, using fallback URL');
      return fallbackUrl;
    }

    // Tối ưu chi phí: Tính thời gian hết hạn phòng (exp) theo endTime + 15 phút gia hạn
    let expTimestamp: number;
    if (endTime) {
      const end = new Date(endTime).getTime();
      expTimestamp = Math.floor(end / 1000) + 900;
      const minExp = Math.floor(Date.now() / 1000) + 600;
      if (expTimestamp < minExp) {
        expTimestamp = minExp;
      }
    } else {
      // Mặc định phòng chỉ tồn tại 8 tiếng thay vì 30 ngày để tránh tiêu hao minutes ngầm
      expTimestamp = Math.floor(Date.now() / 1000) + 28800;
    }

    try {
      const response = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: cleanName,
          privacy: 'public',
          properties: {
            enable_chat: true,
            enable_screenshare: true,
            enable_prejoin_ui: true,
            exp: expTimestamp,
          },
        }),
      });

      const data = (await response.json()) as Record<string, any>;
      if (response.ok && data.url) {
        this.logger.log(
          `Created Daily.co room: ${data.url} (expires in ${Math.round((expTimestamp - Math.floor(Date.now() / 1000)) / 60)} mins)`,
        );
        return String(data.url);
      }

      if (
        response.status === 400 &&
        String(data.info || '').includes('already exists')
      ) {
        this.logger.log(
          `Daily.co room ${cleanName} already exists, using URL: ${fallbackUrl}`,
        );
        return fallbackUrl;
      }

      this.logger.warn(`Daily API response: ${JSON.stringify(data)}`);
      return fallbackUrl;
    } catch (error) {
      this.logger.error('Error creating Daily.co room via API:', error);
      return fallbackUrl;
    }
  }

  async createSession(
    classId: number,
    dto: CreateSessionDto,
    userId?: number,
    role?: string,
  ) {
    if (userId && role !== 'ADMIN') {
      const cls = await this.prisma.class.findUnique({
        where: { id: classId },
      });
      if (!cls) throw new NotFoundException('Không tìm thấy lớp học');
      if (cls.teacherId !== userId) {
        throw new ForbiddenException(
          'Bạn không phải là giảng viên phụ trách lớp học này',
        );
      }
    }

    let meetingLink = dto.meetingLink ? String(dto.meetingLink) : '';
    if (!meetingLink || !meetingLink.includes('daily.co')) {
      const sessionSlug = dto.title
        ? `class-${classId}-${dto.title}`
        : `class-${classId}-${Date.now()}`;
      meetingLink = await this.createDailyRoom(sessionSlug, dto.endTime);
    }

    return this.prisma.session.create({
      data: {
        classId,
        title: dto.title || 'Buổi học trực tuyến',
        startTime: dto.startTime ? new Date(dto.startTime) : new Date(),
        endTime: dto.endTime
          ? new Date(dto.endTime)
          : new Date(Date.now() + 3600000), // 1 hour default
        meetingLink,
      },
    });
  }

  async deleteSession(sessionId: number, userId?: number, role?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { class: true },
    });
    if (!session) {
      throw new NotFoundException('Không tìm thấy buổi học');
    }

    if (userId && role !== 'ADMIN' && session.class.teacherId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền xóa buổi học của lớp này',
      );
    }

    await this.prisma.session.delete({
      where: { id: sessionId },
    });

    if (session.meetingLink && session.meetingLink.includes('daily.co')) {
      const roomName = session.meetingLink.split('/').pop();
      const apiKey = process.env.DAILY_API_KEY;
      if (roomName && apiKey) {
        try {
          await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${apiKey}` },
          });
        } catch (e) {
          this.logger.warn(`Could not delete Daily room ${roomName}: ${e}`);
        }
      }
    }

    return { success: true, message: 'Session deleted successfully' };
  }

  async finishSession(sessionId: number, userId: number, role: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { class: true },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy buổi học');
    }

    if (role !== 'ADMIN' && session.class.teacherId !== userId) {
      throw new ForbiddenException('Bạn không có quyền kết thúc buổi học này');
    }

    const updated = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        endTime: new Date(),
        status: 'completed',
      },
    });

    this.logger.log(
      `Session ${sessionId} was finished early by user ${userId}`,
    );

    return {
      success: true,
      message: 'Buổi học đã được kết thúc thành công',
      session: updated,
    };
  }

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
        sessions: {
          orderBy: { startTime: 'asc' },
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
        teacher: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, avatar: true } },
          },
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
          (e.user.id === userId || (e as any).userId === userId) &&
          (e.status === 'ACTIVE' || e.status === 'COMPLETED'),
      );
      if (!isEnrolled) {
        throw new ForbiddenException(
          'Bạn chưa ghi danh hoặc không có quyền truy cập bài giảng và tài liệu của lớp học này',
        );
      }
    } else if (role === 'TEACHER') {
      if (cls.teacherId !== userId) {
        throw new ForbiddenException(
          'Bạn không phải là giảng viên phụ trách lớp học này',
        );
      }
    }

    return cls;
  }

  async getMyClasses(userId: number, role: string) {
    if (role === 'TEACHER') {
      return this.prisma.class.findMany({
        where: { teacherId: userId },
        include: {
          course: true,
          sessions: { orderBy: { startTime: 'asc' } },
          _count: { select: { enrollments: true } },
        },
        orderBy: { startDate: 'desc' },
      });
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId },
      include: {
        class: {
          include: {
            course: true,
            teacher: {
              select: {
                id: true,
                email: true,
                profile: { select: { fullName: true, avatar: true } },
              },
            },
            sessions: { orderBy: { startTime: 'asc' } },
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

  async updateWatchTracking(userId: number, videoKey: string, payload: any) {
    const existing = await this.prisma.watchTracking.findUnique({
      where: { userId },
    });

    const currentItems = (existing?.items as Record<string, any>) || {};
    currentItems[videoKey] = {
      ...payload,
      updatedAt: new Date().toISOString(),
    };

    return this.prisma.watchTracking.upsert({
      where: { userId },
      update: { items: currentItems },
      create: { userId, items: currentItems },
    });
  }

  // ==========================================
  // TEACHER PORTAL: REWARD BANH RAN FOR STUDENT
  // ==========================================
  async rewardStudentInClass(
    classId: number,
    studentId: number,
    amount: number,
    reason: string,
    teacherId: number,
    role: string,
  ) {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        enrollments: {
          where: { userId: studentId, status: 'ACTIVE' },
        },
      },
    });

    if (!cls) throw new NotFoundException('Không tìm thấy lớp học');
    if (role !== 'ADMIN' && cls.teacherId !== teacherId) {
      throw new ForbiddenException(
        'Bạn không có quyền thưởng cho học sinh của lớp này',
      );
    }
    if (cls.enrollments.length === 0) {
      throw new NotFoundException('Học sinh không thuộc lớp học này');
    }

    // Giới hạn trần thưởng mỗi lần: Teacher tối đa 50 🍞/lần, Admin tối đa 500
    const maxPerTx = role === 'ADMIN' ? 500 : 50;
    const rewardAmount = Math.max(1, Math.min(amount || 20, maxPerTx));
    const rewardReason = reason?.trim() || 'Giáo viên thưởng Bánh Mì';

    if (role !== 'ADMIN') {
      // Kiểm tra trần thưởng trong ngày cho học sinh này (Tối đa 100 🍞/ngày cho nguồn Giáo viên thưởng)
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const todayRewards = await this.prisma.pointHistory.aggregate({
        where: {
          userId: studentId,
          createdAt: { gte: startOfDay },
          reason: { startsWith: '[TEACHER_REWARD]' },
        },
        _sum: { points: true },
      });

      const todayTotal = todayRewards._sum.points || 0;
      if (todayTotal + rewardAmount > 100) {
        throw new ForbiddenException(
          `Đã vượt quá giới hạn thưởng Bánh Mì cho học sinh này trong ngày (Đã thưởng ${todayTotal}/100 🍞 hôm nay)`,
        );
      }
    }

    const updatedStats = await this.prisma.userStats.upsert({
      where: { userId: studentId },
      update: { totalBanhRan: { increment: rewardAmount } },
      create: { userId: studentId, totalBanhRan: rewardAmount },
    });

    await this.prisma.pointHistory.create({
      data: {
        userId: studentId,
        points: rewardAmount,
        reason: `[TEACHER_REWARD] ${cls.name}: ${rewardReason}`,
      },
    });

    const studentUser = await this.prisma.user.findUnique({
      where: { id: studentId },
      include: { profile: true },
    });

    const studentName =
      studentUser?.profile?.fullName || studentUser?.email || 'Học viên';

    this.eventsGateway.sendCurrencyUpdate(studentId, {
      amount: rewardAmount,
      newBalance: updatedStats.totalBanhRan,
      reason: `${cls.name}: ${rewardReason}`,
      studentName,
    });

    return {
      success: true,
      message: `Đã thưởng thành công ${rewardAmount} Bánh Mì cho ${studentName}!`,
      newBalance: updatedStats.totalBanhRan,
    };
  }

  // ==========================================
  // TEACHER PORTAL: ATTENDANCE TRACKING
  // ==========================================
  async getSessionAttendance(
    sessionId: number,
    teacherId: number,
    role: string,
  ) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
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
        },
        attendances: true,
      },
    });

    if (!session) throw new NotFoundException('Không tìm thấy buổi học');
    if (role !== 'ADMIN' && session.class.teacherId !== teacherId) {
      throw new ForbiddenException(
        'Bạn không có quyền xem điểm danh của lớp này',
      );
    }

    const attendanceMap = new Map<number, boolean>();
    session.attendances.forEach((att) => {
      attendanceMap.set(att.userId, att.isPresent);
    });

    const result = session.class.enrollments.map((enr) => ({
      userId: enr.user.id,
      email: enr.user.email,
      fullName: enr.user.profile?.fullName || enr.user.email,
      avatar: enr.user.profile?.avatar,
      isPresent: attendanceMap.has(enr.user.id)
        ? attendanceMap.get(enr.user.id)
        : false,
    }));

    return {
      session: {
        id: session.id,
        title: session.title,
        startTime: session.startTime,
        endTime: session.endTime,
      },
      students: result,
    };
  }

  async saveSessionAttendance(
    sessionId: number,
    teacherId: number,
    role: string,
    records: Array<{ userId: number; isPresent: boolean }>,
  ) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { class: true, attendances: true },
    });

    if (!session) throw new NotFoundException('Không tìm thấy buổi học');
    if (role !== 'ADMIN' && session.class.teacherId !== teacherId) {
      throw new ForbiddenException('Bạn không có quyền điểm danh buổi học này');
    }

    for (const rec of records) {
      await this.prisma.attendance.upsert({
        where: {
          sessionId_userId: {
            sessionId,
            userId: rec.userId,
          },
        },
        update: { isPresent: rec.isPresent },
        create: {
          sessionId,
          userId: rec.userId,
          isPresent: rec.isPresent,
        },
      });

      // Tặng +5 Bánh Mì chuyên cần nếu được điểm danh Có mặt (Đảm bảo Idempotency)
      if (rec.isPresent) {
        const alreadyRewarded = await this.prisma.pointHistory.findFirst({
          where: {
            userId: rec.userId,
            reason: `Chuyên cần: ${session.title}`,
          },
        });

        if (!alreadyRewarded) {
          const stats = await this.prisma.userStats.upsert({
            where: { userId: rec.userId },
            update: { totalBanhRan: { increment: 5 } },
            create: { userId: rec.userId, totalBanhRan: 5 },
          });

          await this.prisma.pointHistory.create({
            data: {
              userId: rec.userId,
              points: 5,
              reason: `Chuyên cần: ${session.title}`,
            },
          });

          const student = await this.prisma.user.findUnique({
            where: { id: rec.userId },
            include: { profile: true },
          });

          this.eventsGateway.sendCurrencyUpdate(rec.userId, {
            amount: 5,
            newBalance: stats.totalBanhRan,
            reason: `Chuyên cần buổi học: ${session.title}`,
            studentName:
              student?.profile?.fullName || student?.email || 'Học viên',
          });
        }
      }
      // Tự động tính toán lại tiến độ học tập (Enrollment.progress) của học viên
      await this.recalculateEnrollmentProgress(session.classId, rec.userId);
    }

    return {
      success: true,
      message: `Đã lưu điểm danh cho ${records.length} học viên thành công!`,
    };
  }

  // ==========================================
  // HELPER: RECALCULATE ENROLLMENT PROGRESS (0 - 100%)
  // Công thức: 50% Điểm danh chuyên cần + 50% Bài tập đã nộp
  // ==========================================
  async recalculateEnrollmentProgress(classId: number, userId: number) {
    try {
      const [totalSessions, totalAssignments] = await Promise.all([
        this.prisma.session.count({ where: { classId } }),
        this.prisma.assignment.count({ where: { classId } }),
      ]);

      if (totalSessions === 0 && totalAssignments === 0) return;

      const [attendedSessions, submittedAssignments] = await Promise.all([
        this.prisma.attendance.count({
          where: {
            session: { classId },
            userId,
            isPresent: true,
          },
        }),
        this.prisma.assignmentSubmission.count({
          where: {
            assignment: { classId },
            userId,
          },
        }),
      ]);

      let progress = 0;
      if (totalSessions > 0 && totalAssignments > 0) {
        const sessionRatio = attendedSessions / totalSessions;
        const assignmentRatio = submittedAssignments / totalAssignments;
        progress = (0.5 * sessionRatio + 0.5 * assignmentRatio) * 100;
      } else if (totalSessions > 0) {
        progress = (attendedSessions / totalSessions) * 100;
      } else if (totalAssignments > 0) {
        progress = (submittedAssignments / totalAssignments) * 100;
      }

      await this.prisma.enrollment.updateMany({
        where: { classId, userId },
        data: { progress: Math.min(100, Math.round(progress)) },
      });
    } catch (error) {
      this.logger.error(
        `Error recalculating progress for user ${userId} in class ${classId}:`,
        error,
      );
    }
  }

  // ==========================================
  // TEACHER PORTAL: STUDENT LEARNING ANALYTICS
  // ==========================================
  async getClassStudentsAnalytics(
    classId: number,
    teacherId: number,
    role: string,
  ) {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        enrollments: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                lastLoginAt: true,
                profile: {
                  select: { fullName: true, avatar: true, phone: true },
                },
                stats: { select: { totalBanhRan: true, streakCount: true } },
              },
            },
          },
        },
        assignments: {
          include: {
            submissions: true,
          },
        },
        sessions: {
          orderBy: { startTime: 'asc' },
          include: {
            attendances: true,
          },
        },
      },
    });

    if (!cls) throw new NotFoundException('Không tìm thấy lớp học');
    if (role !== 'ADMIN' && cls.teacherId !== teacherId) {
      throw new ForbiddenException('Bạn không có quyền xem lớp học này');
    }

    const totalAssignments = cls.assignments.length;
    const totalSessions = cls.sessions.length;

    const students = cls.enrollments.map((enr) => {
      const studentId = enr.user.id;

      // Bài tập đã nộp
      const studentSubmissions = cls.assignments
        .flatMap((a) => a.submissions)
        .filter((sub) => sub.userId === studentId);

      const submittedCount = studentSubmissions.length;
      const gradedSubmissions = studentSubmissions.filter(
        (sub) => sub.grade !== null,
      );
      const avgGrade =
        gradedSubmissions.length > 0
          ? Number(
              (
                gradedSubmissions.reduce(
                  (acc, sub) => acc + (sub.grade || 0),
                  0,
                ) / gradedSubmissions.length
              ).toFixed(1),
            )
          : null;

      // Buổi học đã tham gia
      const attendedCount = cls.sessions
        .flatMap((s) => s.attendances)
        .filter((att) => att.userId === studentId && att.isPresent).length;

      return {
        userId: studentId,
        email: enr.user.email,
        fullName: enr.user.profile?.fullName || enr.user.email,
        avatar: enr.user.profile?.avatar || null,
        phone: enr.user.profile?.phone || null,
        totalBanhRan: enr.user.stats?.totalBanhRan || 0,
        streakCount: enr.user.stats?.streakCount || 0,
        lastLoginAt: enr.user.lastLoginAt,
        totalAssignments,
        submittedAssignmentsCount: submittedCount,
        averageGrade: avgGrade,
        totalSessions,
        attendedSessionsCount: attendedCount,
      };
    });

    return {
      classId: cls.id,
      className: cls.name,
      totalStudents: students.length,
      students,
    };
  }
}
