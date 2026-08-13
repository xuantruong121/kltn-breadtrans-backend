import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCourseDto,
  CreateClassDto,
  CreateLessonDto,
  CreateMaterialDto,
} from './dto/course.dto';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class CourseService {
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
  ) {}

  // ================= COURSES =================

  async createCourse(dto: CreateCourseDto) {
    return this.prisma.course.create({ data: dto });
  }

  async getAllCourses(userId?: number, role?: string) {
    // TEACHER: only their own courses
    if (role === 'TEACHER' && userId) {
      return this.prisma.course.findMany({
        where: { teacherId: userId },
        include: {
          classes: {
            include: {
              _count: { select: { enrollments: true } },
            },
          },
          teacher: { select: { id: true, email: true, profile: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // STUDENT: only courses from classes they are enrolled in
    if (role === 'STUDENT' && userId) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { userId },
        include: {
          class: {
            include: {
              course: {
                include: {
                  teacher: { select: { id: true, email: true, profile: true } },
                },
              },
              teacher: { select: { id: true, email: true, profile: { select: { fullName: true, avatar: true } } } },
              _count: { select: { enrollments: true } },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
      });
      return enrollments.map((e) => ({
        classId: e.classId,
        className: e.class.name,
        classStatus: e.class.status,
        meetingLink: e.class.meetingLink,
        startDate: e.class.startDate,
        endDate: e.class.endDate,
        progress: e.progress,
        enrollmentStatus: e.status,
        joinedAt: e.joinedAt,
        studentCount: e.class._count.enrollments,
        teacher: e.class.teacher,
        course: e.class.course,
      }));
    }

    // Default (Admin handled in AdminModule, this is fallback)
    return this.prisma.course.findMany({
      include: {
        classes: true,
        teacher: { select: { id: true, email: true, profile: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCourseById(id: number) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        classes: {
          include: {
            teacher: { select: { id: true, email: true, profile: true } },
          },
        },
        quizzes: true,
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async deleteCourse(id: number) {
    return this.prisma.course.delete({ where: { id } });
  }

  async updateCourseStatus(id: number, status: any) {
    const updated = await this.prisma.course.update({
      where: { id },
      data: { status },
    });

    // Broadcast the update so frontends can refetch immediately
    this.eventsGateway.broadcastCourseUpdate();

    return updated;
  }

  // ================= CLASSES =================

  async getUserClasses(userId: number, role: string) {
    if (role === 'TEACHER' || role === 'ADMIN') {
      const classes = await this.prisma.class.findMany({
        where: { teacherId: userId },
        include: {
          course: { select: { title: true } },
          sessions: true,
          _count: { select: { enrollments: true } },
          enrollments: {
            include: {
              user: {
                select: { id: true, email: true, profile: { select: { fullName: true, avatar: true } } }
              }
            }
          }
        },
      });
      return classes.map((c) => ({
        ...c,
        studentCount: c._count.enrollments,
      }));
    } else if (role === 'STUDENT') {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { userId },
        include: {
          class: {
            include: {
              course: { select: { title: true } },
              teacher: {
                select: {
                  email: true,
                  profile: { select: { fullName: true } },
                },
              },
              _count: { select: { enrollments: true } },
            },
          },
        },
      });
      return enrollments.map((e) => ({
        ...e.class,
        studentCount: e.class._count.enrollments,
      }));
    }
    return [];
  }

  async createClass(courseId: number, teacherId: number, dto: CreateClassDto) {
    const meetingLink =
      dto.meetingLink ||
      `https://meet.jit.si/kltn-breadtrans-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return this.prisma.class.create({
      data: {
        ...dto,
        courseId,
        teacherId,
        meetingLink,
      },
    });
  }

  async getClassById(classId: number) {
    const classData = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        course: {
          include: {
            lessons: { include: { materials: true } },
          },
        },
        teacher: { select: { id: true, email: true, profile: true } },
      },
    });
    if (!classData) throw new NotFoundException('Class not found');
    return classData;
  }

  async deleteClass(id: number) {
    return this.prisma.class.delete({ where: { id } });
  }

  // ================= LESSONS & MATERIALS =================

  async createLesson(courseId: number, dto: CreateLessonDto) {
    return this.prisma.lesson.create({
      data: {
        ...dto,
        courseId,
      },
    });
  }

  async createMaterial(lessonId: number, dto: CreateMaterialDto) {
    return this.prisma.material.create({
      data: {
        ...dto,
        lessonId,
      },
    });
  }
}
