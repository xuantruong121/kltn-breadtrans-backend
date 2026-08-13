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
                materials: true
              }
            }
          }
        },
        sessions: {
          orderBy: { startTime: 'asc' }
        },
        assignments: {
          include: {
            submissions: role === 'STUDENT' ? {
              where: { userId }
            } : true
          },
          orderBy: { createdAt: 'desc' }
        },
        teacher: {
          select: { id: true, email: true, profile: { select: { fullName: true, avatar: true } } }
        },
        enrollments: {
          include: {
            user: {
              select: { id: true, email: true, profile: { select: { fullName: true, avatar: true } } }
            }
          }
        }
      }
    });
    return cls;
  }
}
