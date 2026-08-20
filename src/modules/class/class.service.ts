import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClassService {
  private readonly logger = new Logger(ClassService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createDailyRoom(requestedName?: string): Promise<string> {
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
            exp: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
          },
        }),
      });

      const data = await response.json();
      if (response.ok && data.url) {
        this.logger.log(`Created Daily.co room: ${data.url}`);
        return data.url;
      }

      if (
        String(data.info || '').includes('already exists') ||
        String(data.error || '').includes('already exists')
      ) {
        this.logger.log(`Daily.co room ${cleanName} already exists, using URL: ${fallbackUrl}`);
        return fallbackUrl;
      }

      this.logger.warn(`Daily API response: ${JSON.stringify(data)}`);
      return fallbackUrl;
    } catch (error) {
      this.logger.error('Error creating Daily.co room via API:', error);
      return fallbackUrl;
    }
  }

  async createSession(classId: number, dto: any) {
    let meetingLink = dto.meetingLink;
    if (!meetingLink || !meetingLink.includes('daily.co')) {
      const sessionSlug = dto.title
        ? `class-${classId}-${dto.title}`
        : `class-${classId}-${Date.now()}`;
      meetingLink = await this.createDailyRoom(sessionSlug);
    }

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

  async deleteSession(sessionId: number) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      return { success: false, message: 'Session not found' };
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

    this.logger.log(`Session ${sessionId} was finished early by user ${userId}`);

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
