import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCourseDto,
  CreateClassDto,
  CreateLessonDto,
  CreateMaterialDto,
} from './dto/course.dto';

@Injectable()
export class CourseService {
  constructor(private prisma: PrismaService) {}

  // ================= COURSES =================

  async createCourse(dto: CreateCourseDto) {
    return this.prisma.course.create({ data: dto });
  }

  async getAllCourses() {
    return this.prisma.course.findMany({
      include: { classes: true },
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

  // ================= CLASSES =================

  async createClass(courseId: number, teacherId: number, dto: CreateClassDto) {
    return this.prisma.class.create({
      data: {
        ...dto,
        courseId,
        teacherId,
      },
    });
  }

  async getClassById(classId: number) {
    const classData = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        lessons: {
          include: { materials: true },
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

  async createLesson(classId: number, dto: CreateLessonDto) {
    return this.prisma.lesson.create({
      data: {
        ...dto,
        classId,
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
