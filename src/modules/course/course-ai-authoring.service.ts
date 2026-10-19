import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseLessonExerciseType,
  CourseStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApplyCourseCurriculumDto,
  ApplyCourseLessonContentDto,
  GenerateCourseCurriculumDto,
  GenerateCourseLessonContentDto,
} from './course-ai-authoring.dto';

type Admin = { id: number; role: Role };

@Injectable()
export class CourseAiAuthoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  private admin(user: Admin) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Admin only');
  }

  private async course(courseId: number) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status !== CourseStatus.DRAFT)
      throw new ConflictException(
        'Chỉ Course Draft mới có thể áp dụng nội dung AI',
      );
    return course;
  }

  private slug(value: string, index: number) {
    const base = value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    return `${base || 'bai-hoc'}-${index + 1}`.slice(0, 180);
  }

  async generateCurriculum(
    courseId: number,
    dto: GenerateCourseCurriculumDto,
    user: Admin,
  ) {
    this.admin(user);
    const course = await this.course(courseId);
    const existing = await this.prisma.courseLesson.findMany({
      where: { courseId },
      select: { title: true },
    });
    const result = await this.ai.suggestCourseCurriculum({
      courseTitle: course.title,
      level: course.level ?? undefined,
      description: [course.description, dto.brief].filter(Boolean).join('\n'),
      targetLessonCount: dto.lessonCount ?? 3,
      existingLessonTitles: existing.map((lesson) => lesson.title),
    });
    return {
      mode: 'CANDIDATE_ONLY',
      candidate: { ...result, candidateCourseId: courseId },
    };
  }

  async applyCurriculum(
    courseId: number,
    dto: ApplyCourseCurriculumDto,
    user: Admin,
  ) {
    this.admin(user);
    await this.course(courseId);
    if (dto.candidateCourseId !== courseId)
      throw new BadRequestException('Candidate không thuộc Course hiện tại');
    const titles = dto.lessons.map((lesson) =>
      lesson.title.trim().toLowerCase(),
    );
    if (new Set(titles).size !== titles.length)
      throw new BadRequestException('Candidate có tiêu đề bài học trùng lặp');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.courseLesson.count({ where: { courseId } });
      if (existing) {
        throw new ConflictException(
          'Course đã có nội dung thủ công; AI không ghi đè. Hãy tạo Course Draft mới hoặc biên soạn từng bài.',
        );
      }
      const lessons = [];
      for (const [index, lesson] of dto.lessons.entries()) {
        const created = await tx.courseLesson.create({
          data: {
            courseId,
            slug: this.slug(lesson.title, index),
            title: lesson.title.trim(),
            summary: lesson.summary.trim(),
            learningObjectives: lesson.objectives
              .map((value) => value.trim())
              .filter(Boolean) as Prisma.InputJsonValue,
            difficulty: undefined,
            order: index,
          },
        });
        await tx.courseLessonSection.createMany({
          data: lesson.sections.map((section, sectionIndex) => ({
            lessonId: created.id,
            order: sectionIndex,
            type: section.type,
            heading: section.heading.trim(),
            content: { text: section.content.trim() } as Prisma.InputJsonValue,
            isRequired: true,
          })),
        });
        lessons.push(created);
      }
      return { mode: 'APPLIED_TO_DRAFT', lessons };
    });
  }

  async generateLessonContent(
    courseId: number,
    lessonId: number,
    dto: GenerateCourseLessonContentDto,
    user: Admin,
  ) {
    this.admin(user);
    const course = await this.course(courseId);
    const lesson = await this.prisma.courseLesson.findFirst({
      where: { id: lessonId, courseId },
      include: { sections: { select: { heading: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const result = await this.ai.suggestCourseLessonContent({
      courseTitle: course.title,
      courseDescription: [course.description, dto.brief]
        .filter(Boolean)
        .join('\n'),
      courseLevel: course.level ?? undefined,
      lessonTitle: lesson.title,
      lessonSummary: lesson.summary,
      objectives: Array.isArray(lesson.learningObjectives)
        ? lesson.learningObjectives.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      existingSectionHeadings: lesson.sections.map(
        (section) => section.heading,
      ),
    });
    return {
      mode: 'CANDIDATE_ONLY',
      candidate: {
        ...result,
        candidateCourseId: courseId,
        candidateLessonId: lessonId,
      },
    };
  }

  async applyLessonContent(
    courseId: number,
    lessonId: number,
    dto: ApplyCourseLessonContentDto,
    user: Admin,
  ) {
    this.admin(user);
    await this.course(courseId);
    if (
      dto.candidateCourseId !== courseId ||
      dto.candidateLessonId !== lessonId
    )
      throw new BadRequestException('Candidate không thuộc Lesson hiện tại');
    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.courseLesson.findFirst({
        where: { id: lessonId, courseId },
        include: { sections: true, exercises: true },
      });
      if (!lesson) throw new NotFoundException('Lesson not found');
      if (lesson.exercises.length)
        throw new ConflictException(
          'Lesson đã có bài tập; AI không ghi đè nội dung thủ công',
        );
      const existingHeadings = new Set(
        lesson.sections.map((section) => section.heading.trim().toLowerCase()),
      );
      const additions = dto.sections.filter(
        (section) =>
          !existingHeadings.has(section.heading.trim().toLowerCase()),
      );
      if (additions.length) {
        await tx.courseLessonSection.createMany({
          data: additions.map((section, index) => ({
            lessonId,
            order: lesson.sections.length + index,
            type: section.type,
            heading: section.heading.trim(),
            content: { text: section.content.trim() } as Prisma.InputJsonValue,
            isRequired: true,
          })),
        });
      }
      const exercise = dto.exercise;
      const created = await tx.courseLessonExercise.create({
        data: {
          lessonId,
          slug: `ai-practice-${Date.now()}`,
          order: lesson.exercises.length,
          type: exercise.type as CourseLessonExerciseType,
          title: exercise.title.trim(),
          prompt: exercise.prompt.trim(),
          instructions: exercise.instructions?.trim(),
          content: {},
          required: true,
          questions: {
            create: {
              order: 0,
              prompt: exercise.question.prompt.trim(),
              options: exercise.question.options as
                Prisma.InputJsonValue | undefined,
              correctAnswer:
                exercise.question.correctAnswer.trim() as Prisma.InputJsonValue,
              explanation: exercise.question.explanation.trim(),
            },
          },
        },
      });
      return { mode: 'APPLIED_TO_DRAFT', exercise: created };
    });
  }
}
