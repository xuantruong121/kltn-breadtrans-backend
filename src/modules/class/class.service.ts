import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClassService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(classId: number, dto: any) {
    const meetingLink =
      dto.meetingLink ||
      `https://meet.jit.si/class-${classId}-session-${Date.now()}`;
    return this.prisma.session.create({
      data: {
        classId,
        title: dto.title,
        startTime: dto.startTime ? new Date(dto.startTime) : new Date(),
        endTime: dto.endTime
          ? new Date(dto.endTime)
          : new Date(Date.now() + 3600000), // 1 hour default
        meetingLink,
      },
    });
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

    // Default STUDENT
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
            sessions: {
              where: { endTime: { gte: new Date() } },
              orderBy: { startTime: 'asc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return enrollments.map((e) => ({
      ...e.class,
      enrollmentProgress: e.progress,
      enrollmentStatus: e.status,
      nextSession: e.class.sessions[0] || null,
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
}
