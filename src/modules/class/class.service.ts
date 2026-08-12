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

  async createAssignment(classId: number, dto: any) {
    return this.prisma.assignment.create({
      data: {
        classId,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
    });
  }
}
