import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CourseLessonStatus, CourseStatus, Role } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApplyCourseCurriculumDto,
  ApplyCourseLessonContentDto,
  GenerateCourseCurriculumDto,
  GenerateCourseLessonContentDto,
  RefineCourseLessonSectionDto,
} from './course-ai-authoring.dto';
import { reviewLessonContentCandidate } from './course-ai-content-quality';

type Admin = { id: number; role: Role };

type SectionContentInput = {
  content: string;
  paragraphs?: string[];
  bullets?: string[];
  examples?: Array<{
    text: string;
    translation?: string;
    explanation?: string;
  }>;
};

/** Single canonical write format for Course Section content, so AI Apply and
 * the Admin editor store the same shape. */
const sectionContentJson = (
  section: SectionContentInput,
  original?: unknown,
) => {
  const text = section.content.trim();
  const paragraphs = (section.paragraphs ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  const extensions =
    original && typeof original === 'object' && !Array.isArray(original)
      ? { ...(original as Record<string, unknown>) }
      : {};
  return {
    ...extensions,
    text,
    paragraphs: paragraphs.length ? paragraphs : text ? [text] : [],
    bullets: (section.bullets ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
    examples: (section.examples ?? [])
      .filter((example) => example.text?.trim())
      .map((example) => ({
        text: example.text.trim(),
        ...(example.translation?.trim()
          ? { translation: example.translation.trim() }
          : {}),
        ...(example.explanation?.trim()
          ? { explanation: example.explanation.trim() }
          : {}),
      })),
  };
};

const sectionText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const record = content as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.trim()) return record.text;
  const paragraphs = Array.isArray(record.paragraphs)
    ? record.paragraphs.filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
  return paragraphs.join('\n\n');
};

const sectionStringList = (content: unknown, key: string): string[] => {
  if (!content || typeof content !== 'object') return [];
  const value = (content as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
};

const sectionExamples = (content: unknown) => {
  if (!content || typeof content !== 'object') return [];
  const value = (content as Record<string, unknown>).examples;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ text: item.trim() }];
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.text !== 'string' || !record.text.trim()) return [];
    return [
      {
        text: record.text.trim(),
        translation:
          typeof record.translation === 'string'
            ? record.translation
            : undefined,
        explanation:
          typeof record.explanation === 'string'
            ? record.explanation
            : undefined,
      },
    ];
  });
};

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

  private assertLessonDraft(lesson: { status: CourseLessonStatus }) {
    if (lesson.status === CourseLessonStatus.PUBLISHED)
      throw new ConflictException(
        'Bài học đã được xuất bản. Hãy chuyển bài học về bản nháp trước khi dùng AI.',
      );
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
              .filter(Boolean),
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
            content: sectionContentJson(section),
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
      include: {
        sections: {
          select: { id: true, type: true, heading: true, content: true },
        },
        exercises: { select: { slug: true } },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    this.assertLessonDraft(lesson);
    const objectives = this.objectives(lesson.learningObjectives);
    const scope = dto.scope ?? 'FULL';
    const siblings = await this.prisma.courseLesson.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        order: true,
        title: true,
        summary: true,
        learningObjectives: true,
      },
    });
    const result = await this.ai.suggestCourseLessonContent({
      courseTitle: course.title,
      courseDescription: [course.description, dto.brief]
        .filter(Boolean)
        .join('\n'),
      courseLevel: course.level ?? undefined,
      lessonTitle: lesson.title,
      lessonSummary: lesson.summary,
      objectives,
      existingSectionHeadings: lesson.sections.map(
        (section) => section.heading,
      ),
      existingExerciseSlugs: lesson.exercises.map((exercise) => exercise.slug),
      previousLessons: siblings
        .filter((item) => item.order < lesson.order)
        .map((item) => ({
          title: item.title,
          summary: item.summary,
          objectives: this.objectives(item.learningObjectives),
        })),
      nextLessonTitle: siblings.find((item) => item.order > lesson.order)
        ?.title,
      existingSections: lesson.sections.map((section) => ({
        type: section.type,
        heading: section.heading,
        text: sectionText(section.content),
        bullets: sectionStringList(section.content, 'bullets'),
        examples: sectionExamples(section.content).map(
          (example) => example.text,
        ),
      })),
      mode: scope === 'IMPROVE_SECTIONS' ? 'IMPROVE' : 'CREATE',
    });
    const sections =
      scope === 'IMPROVE_SECTIONS'
        ? this.matchExistingSections(result.sections, lesson.sections)
        : result.sections;
    const candidate = {
      candidateCourseId: courseId,
      candidateLessonId: lessonId,
      ...(scope === 'FULL' ||
      scope === 'SECTIONS' ||
      scope === 'IMPROVE_SECTIONS'
        ? { sections }
        : { sections: [] }),
      ...(scope === 'FULL' || scope === 'GUIDED_PRACTICE'
        ? { guidedPractice: result.guidedPractice }
        : {}),
      ...(scope === 'FULL' || scope === 'FINAL_CHECK'
        ? { finalCheck: result.finalCheck }
        : {}),
    };
    const review = reviewLessonContentCandidate({
      sections: candidate.sections,
      guidedPractice: candidate.guidedPractice,
      finalCheck: candidate.finalCheck,
      objectives,
    });
    return {
      mode: 'CANDIDATE_ONLY',
      candidate: {
        ...candidate,
        scope,
        pedagogyPlan: result.pedagogyPlan,
        warnings: review.warnings,
        duplicateQuestionCount: review.duplicateQuestionCount,
      },
    };
  }

  /** Links an IMPROVE candidate to the Draft sections it revises, so Apply can
   * update in place instead of appending a near-duplicate section. */
  private matchExistingSections(
    suggested: Array<{ heading: string; type: string }>,
    existing: Array<{ id: number; heading: string; type: string }>,
  ) {
    const key = (value: string) => value.trim().toLowerCase();
    const byHeading = new Map(
      existing.map((section) => [key(section.heading), section]),
    );
    const byType = new Map(
      existing.map((section) => [section.type, section] as const),
    );
    return suggested.map((section) => {
      const match =
        byHeading.get(key(section.heading)) ?? byType.get(section.type);
      return match ? { ...section, sectionId: match.id } : section;
    });
  }

  private objectives(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  async refineLessonSection(
    courseId: number,
    lessonId: number,
    sectionId: number,
    dto: RefineCourseLessonSectionDto,
    user: Admin,
  ) {
    this.admin(user);
    const course = await this.course(courseId);
    const section = await this.prisma.courseLessonSection.findFirst({
      where: { id: sectionId, lesson: { id: lessonId, courseId } },
      include: { lesson: true },
    });
    if (!section) throw new NotFoundException('Section not found');
    this.assertLessonDraft(section.lesson);
    const suggestion = await this.ai.suggestCourseSectionRefinement({
      action: dto.action,
      courseTitle: course.title,
      courseLevel: course.level ?? undefined,
      lessonTitle: section.lesson.title,
      objectives: this.objectives(section.lesson.learningObjectives),
      section: {
        type: section.type,
        heading: section.heading,
        text: sectionText(section.content),
        paragraphs: sectionStringList(section.content, 'paragraphs'),
        bullets: sectionStringList(section.content, 'bullets'),
        examples: sectionExamples(section.content),
      },
    });
    return {
      mode: 'CANDIDATE_ONLY',
      candidate: {
        candidateCourseId: courseId,
        candidateLessonId: lessonId,
        scope: 'SECTION_REFINE',
        action: dto.action,
        sections: [{ ...suggestion, sectionId }],
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
    if (!dto.sections?.length && !dto.guidedPractice && !dto.finalCheck)
      throw new BadRequestException('Candidate không có nội dung để áp dụng');
    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.courseLesson.findFirst({
        where: { id: lessonId, courseId },
        include: { sections: true, exercises: true },
      });
      if (!lesson) throw new NotFoundException('Lesson not found');
      this.assertLessonDraft(lesson);
      const existingIds = new Set(lesson.sections.map((section) => section.id));
      const existingHeadings = new Set(
        lesson.sections.map((section) => section.heading.trim().toLowerCase()),
      );
      /** Admin explicitly accepted a revision of a section that already
       * exists, so update it in place instead of appending a duplicate. */
      const revisions = (dto.sections ?? []).filter(
        (section) => section.sectionId && existingIds.has(section.sectionId),
      );
      for (const section of revisions) {
        await tx.courseLessonSection.update({
          where: { id: section.sectionId },
          data: {
            type: section.type,
            heading: section.heading.trim(),
            content: sectionContentJson(
              section,
              lesson.sections.find((item) => item.id === section.sectionId)
                ?.content,
            ),
          },
        });
      }
      const additions = (dto.sections ?? []).filter(
        (section) =>
          !(section.sectionId && existingIds.has(section.sectionId)) &&
          !existingHeadings.has(section.heading.trim().toLowerCase()),
      );
      if (additions.length) {
        await tx.courseLessonSection.createMany({
          data: additions.map((section, index) => ({
            lessonId,
            order: lesson.sections.length + index,
            type: section.type,
            heading: section.heading.trim(),
            content: sectionContentJson(section),
            isRequired: true,
          })),
        });
      }
      const existingSlugs = new Set(
        lesson.exercises.map((exercise) => exercise.slug),
      );
      const candidates = [
        { slug: 'guided-practice', candidate: dto.guidedPractice },
        { slug: 'final-check', candidate: dto.finalCheck },
      ].filter(({ slug, candidate }) => candidate && !existingSlugs.has(slug));
      const exercises = await Promise.all(
        candidates.map(({ slug, candidate }, index) =>
          tx.courseLessonExercise.create({
            data: {
              lessonId,
              slug,
              order: lesson.exercises.length + index,
              type: candidate!.type,
              title: candidate!.title.trim(),
              prompt: candidate!.prompt.trim(),
              instructions: candidate!.instructions?.trim(),
              content: {},
              required: true,
              questions: {
                create: candidate!.questions.map((question, questionIndex) => ({
                  order: questionIndex,
                  prompt: question.prompt.trim(),
                  options: question.options,
                  correctAnswer: question.correctAnswer.trim(),
                  explanation: question.explanation.trim(),
                })),
              },
            },
          }),
        ),
      );
      return {
        mode: 'APPLIED_TO_DRAFT',
        sectionsAdded: additions.length,
        exercises,
        skippedExerciseSlugs: ['guided-practice', 'final-check'].filter(
          (slug) => existingSlugs.has(slug),
        ),
      };
    });
  }
}
