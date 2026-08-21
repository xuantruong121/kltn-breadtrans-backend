import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassService } from '../class/class.service';

@Injectable()
export class TeacherService {
  private readonly logger = new Logger(TeacherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly classService: ClassService,
  ) {}

  // ==========================================
  // 1. DASHBOARD OVERVIEW (3 Thẻ Thống Kê Chính)
  // ==========================================
  async getDashboardOverview(teacherId: number) {
    // 1. Học sinh đang theo học (Distinct COUNT qua Enrollment ACTIVE của các lớp teacherId phụ trách)
    const activeEnrollments = await this.prisma.enrollment.findMany({
      where: {
        status: 'ACTIVE',
        class: { teacherId },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    const totalActiveStudents = activeEnrollments.length;

    // 2. Buổi học đã hoàn thành (All-time và Trong tháng này)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const completedSessions = await this.prisma.session.findMany({
      where: {
        class: { teacherId },
        OR: [{ status: 'completed' }, { endTime: { lte: new Date() } }],
      },
      select: { startTime: true, endTime: true },
    });

    const totalSessionsAllTime = completedSessions.length;
    const thisMonthSessions = completedSessions.filter(
      (s) => new Date(s.startTime) >= startOfMonth,
    );
    const totalSessionsThisMonth = thisMonthSessions.length;

    // 3. Tổng thời gian dạy tích lũy (SUM endTime - startTime -> quy ra Giờ)
    const totalMinutesAllTime = completedSessions.reduce((acc, s) => {
      const duration =
        (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) /
        (1000 * 60);
      return acc + (duration > 0 ? duration : 0);
    }, 0);
    const totalTeachingHours = Number((totalMinutesAllTime / 60).toFixed(1));

    const thisMonthMinutes = thisMonthSessions.reduce((acc, s) => {
      const duration =
        (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) /
        (1000 * 60);
      return acc + (duration > 0 ? duration : 0);
    }, 0);
    const thisMonthTeachingHours = Number((thisMonthMinutes / 60).toFixed(1));

    const totalClasses = await this.prisma.class.count({
      where: { teacherId },
    });

    return {
      totalActiveStudents,
      totalSessions: totalSessionsAllTime,
      totalSessionsThisMonth,
      totalTeachingHours,
      thisMonthTeachingHours,
      totalClasses,
    };
  }

  // ==========================================
  // 2. UPCOMING SESSIONS (Lịch Dạy Sắp Tới)
  // ==========================================
  async getUpcomingSessions(teacherId: number, limit = 8) {
    const sessions = await this.prisma.session.findMany({
      where: {
        class: { teacherId },
        endTime: { gte: new Date() },
      },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            course: {
              select: { title: true, thumbnail: true },
            },
            _count: {
              select: { enrollments: true },
            },
          },
        },
      },
      orderBy: { startTime: 'asc' },
      take: limit,
    });

    return sessions;
  }

  // ==========================================
  // 3. SCHEDULE (Thời Khóa Biểu Tuần / Tháng)
  // ==========================================
  async getSchedule(teacherId: number, startDate?: string, endDate?: string) {
    const whereClause: any = {
      class: { teacherId },
    };

    if (startDate && endDate) {
      whereClause.startTime = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const sessions = await this.prisma.session.findMany({
      where: whereClause,
      include: {
        class: {
          select: {
            id: true,
            name: true,
            course: {
              select: { title: true },
            },
            _count: {
              select: { enrollments: true },
            },
          },
        },
        attendances: {
          select: { id: true, userId: true, isPresent: true },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    // Thống kê nhanh trong phạm vi lọc
    const totalMinutes = sessions.reduce((acc, s) => {
      const duration =
        (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) /
        (1000 * 60);
      return acc + (duration > 0 ? duration : 0);
    }, 0);

    const distinctClassIds = new Set(sessions.map((s) => s.classId));

    return {
      summary: {
        totalSessions: sessions.length,
        totalHours: Number((totalMinutes / 60).toFixed(1)),
        totalClasses: distinctClassIds.size,
      },
      sessions,
    };
  }

  // ==========================================
  // 4. UPDATE LESSON NOTE (Cập Nhật Ghi Chú Buổi Học)
  // ==========================================
  async updateSessionNote(
    sessionId: number,
    teacherId: number,
    role: string,
    lessonNote: string,
  ) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { class: true },
    });

    if (!session) throw new NotFoundException('Không tìm thấy buổi học');
    if (role !== 'ADMIN' && session.class.teacherId !== teacherId) {
      throw new ForbiddenException(
        'Bạn không có quyền chỉnh sửa buổi học của lớp này',
      );
    }

    const updated = await this.prisma.session.update({
      where: { id: sessionId },
      data: { lessonNote: lessonNote?.trim() || null } as any,
    });

    return updated;
  }

  // ==========================================
  // 5. CREATE SESSION FOR TEACHER CLASS
  // ==========================================
  async createSession(
    teacherId: number,
    role: string,
    classId: number,
    dto: any,
  ) {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
    });

    if (!cls) throw new NotFoundException('Không tìm thấy lớp học');
    if (role !== 'ADMIN' && cls.teacherId !== teacherId) {
      throw new ForbiddenException(
        'Bạn không có quyền tạo buổi học cho lớp này',
      );
    }

    return this.classService.createSession(classId, dto);
  }
}
