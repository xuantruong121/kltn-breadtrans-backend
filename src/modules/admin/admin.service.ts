import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role, CourseStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats() {
    const [
      totalStudents,
      totalTeachers,
      totalCourses,
      pendingCourses,
      totalEnrollments,
      recentEnrollments,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.STUDENT } }),
      this.prisma.user.count({ where: { role: Role.TEACHER } }),
      this.prisma.course.count({ where: { status: CourseStatus.PUBLISHED } }),
      this.prisma.course.count({ where: { status: CourseStatus.PENDING_REVIEW } }),
      this.prisma.enrollment.count(),
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
    ]);

    const recentActivity = recentEnrollments.map((e) => ({
      id: e.id,
      type: 'enrollment',
      message: `${e.user.profile?.fullName || e.user.email} vua duoc ghi danh vao "${e.class.course.title}"`,
      avatar: e.user.profile?.avatar || null,
      createdAt: e.joinedAt,
    }));

    return {
      stats: { totalStudents, totalTeachers, totalCourses, pendingCourses, totalEnrollments },
      recentActivity,
    };
  }

  async getAllUsers(role?: string) {
    return this.prisma.user.findMany({
      where: role ? { role: role as Role } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, role: true, createdAt: true, lastLoginAt: true, loginCount: true,
        profile: { select: { fullName: true, avatar: true, phone: true } },
      },
    });
  }

  async createUser(dto: { email: string; password: string; role: Role; fullName: string; phone?: string }) {
    const hashed = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        role: dto.role,
        profile: { create: { fullName: dto.fullName, phone: dto.phone } },
      },
      select: {
        id: true, email: true, role: true, createdAt: true,
        profile: { select: { fullName: true, phone: true } },
      },
    });
  }

  async deleteUser(userId: number) {
    return this.prisma.user.delete({ where: { id: userId } });
  }

  async enrollUserInClass(userId: number, classId: number) {
    const existing = await this.prisma.enrollment.findFirst({ where: { userId, classId } });
    if (existing) return existing;
    return this.prisma.enrollment.create({ data: { userId, classId, status: 'ACTIVE', progress: 0 } });
  }

  async removeEnrollment(userId: number, classId: number) {
    return this.prisma.enrollment.deleteMany({ where: { userId, classId } });
  }

  async getEnrollmentsByClass(classId: number) {
    return this.prisma.enrollment.findMany({
      where: { classId },
      orderBy: { joinedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true, email: true,
            profile: { select: { fullName: true, avatar: true, phone: true } },
          },
        },
      },
    });
  }
}
