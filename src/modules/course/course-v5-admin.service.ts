import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseLessonExerciseType,
  CourseLessonStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseService } from './course.service';
import { UploadService } from '../upload/upload.service';
import {
  CreateV5ExerciseDto,
  CreateV5LessonDto,
  CreateV5MediaDto,
  CreateV5QuestionDto,
  CreateV5SectionDto,
  ReorderV5Dto,
  UpdateV5CourseDto,
  UpdateV5ExerciseDto,
  UpdateV5LessonDto,
  UpdateV5QuestionDto,
  UpdateV5SectionDto,
} from './course-v5-admin.dto';

type Admin = { id: number; role: Role };

@Injectable()
export class CourseV5AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courseService: CourseService,
    private readonly upload: UploadService,
  ) {}

  private admin(user: Admin) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Admin only');
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return value ?? {};
  }

  private async course(courseId: number) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async getStudio(courseId: number, user: Admin) {
    this.admin(user);
    const course = await this.course(courseId);
    const data = await this.prisma.courseLesson.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      include: {
        sections: { orderBy: { order: 'asc' } },
        media: true,
        references: true,
        exercises: {
          orderBy: { order: 'asc' },
          include: { questions: { orderBy: { order: 'asc' } } },
        },
      },
    });
    return { course, lessons: data };
  }

  async updateCourse(courseId: number, dto: UpdateV5CourseDto, user: Admin) {
    this.admin(user);
    await this.course(courseId);
    return this.prisma.course.update({
      where: { id: courseId },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        thumbnail: dto.thumbnail,
        level: dto.level,
      },
    });
  }

  async createLesson(courseId: number, dto: CreateV5LessonDto, user: Admin) {
    this.admin(user);
    await this.course(courseId);
    const duplicate = await this.prisma.courseLesson.findFirst({
      where: { courseId, slug: dto.slug.trim() },
    });
    if (duplicate) throw new ConflictException('Slug bài học đã tồn tại');
    const last = await this.prisma.courseLesson.findFirst({
      where: { courseId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.courseLesson.create({
      data: {
        courseId,
        slug: dto.slug.trim(),
        title: dto.title.trim(),
        summary: dto.summary.trim(),
        learningObjectives: this.json(dto.learningObjectives),
        estimatedMinutes: dto.estimatedMinutes ?? 15,
        difficulty: dto.difficulty,
        coverImage: dto.coverImage,
        order: dto.order ?? (last?.order ?? -1) + 1,
        requiresFinalCheck: dto.requiresFinalCheck ?? true,
      },
    });
  }

  async updateLesson(
    courseId: number,
    lessonId: number,
    dto: UpdateV5LessonDto,
    user: Admin,
  ) {
    this.admin(user);
    const lesson = await this.lesson(courseId, lessonId);
    const attempts = await this.prisma.courseLessonAttempt.count({
      where: { lessonId },
    });
    if (
      attempts &&
      (dto.title ||
        dto.slug ||
        dto.summary ||
        dto.learningObjectives ||
        dto.coverImage)
    ) {
      throw new ConflictException(
        'Bài học đã có lịch sử học; không thể sửa nội dung phá vỡ lịch sử',
      );
    }
    return this.prisma.courseLesson.update({
      where: { id: lesson.id },
      data: {
        slug: dto.slug?.trim(),
        title: dto.title?.trim(),
        summary: dto.summary?.trim(),
        learningObjectives: dto.learningObjectives
          ? this.json(dto.learningObjectives)
          : undefined,
        estimatedMinutes: dto.estimatedMinutes,
        difficulty: dto.difficulty,
        coverImage: dto.coverImage,
        order: dto.order,
        status: dto.status,
        requiresFinalCheck: dto.requiresFinalCheck,
      },
    });
  }

  async deleteLesson(courseId: number, lessonId: number, user: Admin) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    const attempts = await this.prisma.courseLessonAttempt.count({
      where: { lessonId },
    });
    if (attempts)
      throw new ConflictException('Không thể xóa bài học đã có lịch sử học');
    return this.prisma.courseLesson.delete({ where: { id: lessonId } });
  }

  async reorderLessons(courseId: number, dto: ReorderV5Dto, user: Admin) {
    this.admin(user);
    const rows = await this.prisma.courseLesson.findMany({
      where: { courseId },
      select: { id: true },
    });
    this.assertSameIds(
      rows.map((row) => row.id),
      dto.ids,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.courseLesson.updateMany({
        where: { courseId },
        data: { order: { increment: 1000000 } },
      });
      for (const [index, id] of dto.ids.entries())
        await tx.courseLesson.update({ where: { id }, data: { order: index } });
    });
    return this.getStudio(courseId, user);
  }

  async createSection(
    courseId: number,
    lessonId: number,
    dto: CreateV5SectionDto,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    this.validateSection(dto);
    const last = await this.prisma.courseLessonSection.findFirst({
      where: { lessonId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = dto.order ?? (last?.order ?? -1) + 1;
    return this.prisma.$transaction(async (tx) => {
      if (dto.order !== undefined) {
        await tx.courseLessonSection.updateMany({
          where: { lessonId, order: { gte: order } },
          data: { order: { increment: 1 } },
        });
      }
      return tx.courseLessonSection.create({
        data: {
          lessonId,
          type: dto.type,
          heading: dto.heading.trim(),
          content: this.json(dto.content),
          isRequired: dto.isRequired ?? true,
          order,
        },
      });
    });
  }

  async updateSection(
    courseId: number,
    lessonId: number,
    sectionId: number,
    dto: UpdateV5SectionDto,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    const section = await this.prisma.courseLessonSection.findFirst({
      where: { id: sectionId, lessonId },
    });
    if (!section) throw new NotFoundException('Section not found');
    if (dto.heading !== undefined && !dto.heading.trim())
      throw new BadRequestException('Section cần tiêu đề');
    return this.prisma.courseLessonSection.update({
      where: { id: sectionId },
      data: {
        type: dto.type,
        heading: dto.heading?.trim(),
        content: dto.content === undefined ? undefined : this.json(dto.content),
        isRequired: dto.isRequired,
        order: dto.order,
      },
    });
  }

  async deleteSection(
    courseId: number,
    lessonId: number,
    sectionId: number,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    const section = await this.prisma.courseLessonSection.findFirst({
      where: { id: sectionId, lessonId },
    });
    if (!section) throw new NotFoundException('Section not found');
    return this.prisma.courseLessonSection.delete({ where: { id: sectionId } });
  }

  async reorderSections(
    courseId: number,
    lessonId: number,
    dto: ReorderV5Dto,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    const rows = await this.prisma.courseLessonSection.findMany({
      where: { lessonId },
      select: { id: true },
    });
    this.assertSameIds(
      rows.map((row) => row.id),
      dto.ids,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.courseLessonSection.updateMany({
        where: { lessonId },
        data: { order: { increment: 1000000 } },
      });
      for (const [index, id] of dto.ids.entries())
        await tx.courseLessonSection.update({
          where: { id },
          data: { order: index },
        });
    });
    return { success: true };
  }

  async attachMedia(
    courseId: number,
    lessonId: number,
    dto: CreateV5MediaDto,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    if (!['image', 'audio', 'video', 'document'].includes(dto.type))
      throw new BadRequestException('Loại media không được hỗ trợ');
    return this.prisma.courseLessonMedia.create({
      data: {
        lessonId,
        type: dto.type,
        url: dto.url.trim(),
        altText: dto.altText?.trim(),
        provenance: dto.provenance?.trim(),
      },
    });
  }

  async unlinkMedia(
    courseId: number,
    lessonId: number,
    mediaId: number,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    const media = await this.prisma.courseLessonMedia.findFirst({
      where: { id: mediaId, lessonId },
    });
    if (!media) throw new NotFoundException('Media not found');
    // Relation-only unlink is intentional: shared R2 objects are never deleted here.
    return this.prisma.courseLessonMedia.delete({ where: { id: mediaId } });
  }

  async mediaPresign(
    courseId: number,
    lessonId: number,
    mimeType: string,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    if (
      !/^(image|audio|video|application\/pdf)\//.test(mimeType) &&
      mimeType !== 'application/pdf'
    )
      throw new BadRequestException('MIME type không được hỗ trợ');
    const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');
    const key = `courses/${courseId}/lessons/${lessonId}/${crypto.randomUUID()}.${extension}`;
    const presignedUrl = await this.upload.getPresignedUploadUrl(key, mimeType);
    return { key, presignedUrl, url: this.upload.getPublicAssetUrl(key) };
  }

  async createExercise(
    courseId: number,
    lessonId: number,
    dto: CreateV5ExerciseDto,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    const last = await this.prisma.courseLessonExercise.findFirst({
      where: { lessonId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.courseLessonExercise.create({
      data: {
        lessonId,
        slug: dto.slug.trim(),
        type: dto.type,
        title: dto.title.trim(),
        prompt: dto.prompt.trim(),
        instructions: dto.instructions,
        content: this.json(dto.content),
        rubric: dto.rubric === undefined ? undefined : this.json(dto.rubric),
        required: dto.required ?? true,
        minimumScore: dto.minimumScore,
        order: dto.order ?? (last?.order ?? -1) + 1,
      },
    });
  }

  async updateExercise(
    courseId: number,
    lessonId: number,
    exerciseId: number,
    dto: UpdateV5ExerciseDto,
    user: Admin,
  ) {
    this.admin(user);
    await this.exercise(courseId, lessonId, exerciseId);
    const attempts = await this.prisma.courseLessonAttempt.count({
      where: { exerciseId },
    });
    if (
      attempts &&
      (dto.slug || dto.title || dto.prompt || dto.content || dto.rubric)
    )
      throw new ConflictException(
        'Bài tập đã có lịch sử; không thể sửa nội dung phá vỡ lịch sử',
      );
    return this.prisma.courseLessonExercise.update({
      where: { id: exerciseId },
      data: {
        slug: dto.slug?.trim(),
        type: dto.type,
        title: dto.title?.trim(),
        prompt: dto.prompt?.trim(),
        instructions: dto.instructions,
        content: dto.content === undefined ? undefined : this.json(dto.content),
        rubric: dto.rubric === undefined ? undefined : this.json(dto.rubric),
        required: dto.required,
        minimumScore: dto.minimumScore,
        order: dto.order,
      },
    });
  }

  async deleteExercise(
    courseId: number,
    lessonId: number,
    exerciseId: number,
    user: Admin,
  ) {
    this.admin(user);
    await this.exercise(courseId, lessonId, exerciseId);
    if (await this.prisma.courseLessonAttempt.count({ where: { exerciseId } }))
      throw new ConflictException('Không thể xóa bài tập đã có lịch sử');
    return this.prisma.courseLessonExercise.delete({
      where: { id: exerciseId },
    });
  }

  async reorderExercises(
    courseId: number,
    lessonId: number,
    dto: ReorderV5Dto,
    user: Admin,
  ) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    const rows = await this.prisma.courseLessonExercise.findMany({
      where: { lessonId },
      select: { id: true },
    });
    this.assertSameIds(
      rows.map((row) => row.id),
      dto.ids,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.courseLessonExercise.updateMany({
        where: { lessonId },
        data: { order: { increment: 1000000 } },
      });
      for (const [index, id] of dto.ids.entries())
        await tx.courseLessonExercise.update({
          where: { id },
          data: { order: index },
        });
    });
    return { success: true };
  }

  async createQuestion(
    courseId: number,
    lessonId: number,
    exerciseId: number,
    dto: CreateV5QuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const exercise = await this.exercise(courseId, lessonId, exerciseId);
    this.validateQuestion(exercise.type, dto);
    const last = await this.prisma.courseLessonQuestion.findFirst({
      where: { exerciseId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.courseLessonQuestion.create({
      data: {
        exerciseId,
        prompt: dto.prompt.trim(),
        options: dto.options === undefined ? undefined : this.json(dto.options),
        correctAnswer: this.json(dto.correctAnswer),
        explanation: dto.explanation.trim(),
        order: dto.order ?? (last?.order ?? -1) + 1,
      },
    });
  }

  async updateQuestion(
    courseId: number,
    lessonId: number,
    exerciseId: number,
    questionId: number,
    dto: UpdateV5QuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const exercise = await this.exercise(courseId, lessonId, exerciseId);
    const question = await this.prisma.courseLessonQuestion.findFirst({
      where: { id: questionId, exerciseId },
    });
    if (!question) throw new NotFoundException('Question not found');
    if (
      await this.prisma.courseLessonExerciseAnswer.count({
        where: { questionId },
      })
    )
      throw new ConflictException(
        'Câu hỏi đã có câu trả lời lịch sử; không thể sửa hoặc xóa',
      );
    if (dto.prompt !== undefined && !dto.prompt.trim())
      throw new BadRequestException('Câu hỏi cần nội dung');
    if (dto.explanation !== undefined && !dto.explanation.trim())
      throw new BadRequestException('Câu hỏi cần giải thích');
    if (dto.options !== undefined || dto.correctAnswer !== undefined)
      this.validateQuestion(exercise.type, {
        prompt: dto.prompt ?? question.prompt,
        options: dto.options,
        correctAnswer: dto.correctAnswer ?? question.correctAnswer,
        explanation: dto.explanation ?? question.explanation,
      });
    return this.prisma.courseLessonQuestion.update({
      where: { id: questionId },
      data: {
        prompt: dto.prompt?.trim(),
        options: dto.options === undefined ? undefined : this.json(dto.options),
        correctAnswer:
          dto.correctAnswer === undefined
            ? undefined
            : this.json(dto.correctAnswer),
        explanation: dto.explanation?.trim(),
        order: dto.order,
      },
    });
  }

  async deleteQuestion(
    courseId: number,
    lessonId: number,
    exerciseId: number,
    questionId: number,
    user: Admin,
  ) {
    this.admin(user);
    await this.exercise(courseId, lessonId, exerciseId);
    if (
      !(await this.prisma.courseLessonQuestion.findFirst({
        where: { id: questionId, exerciseId },
      }))
    )
      throw new NotFoundException('Question not found');
    if (
      await this.prisma.courseLessonExerciseAnswer.count({
        where: { questionId },
      })
    )
      throw new ConflictException('Không thể xóa câu hỏi đã có lịch sử');
    return this.prisma.courseLessonQuestion.delete({
      where: { id: questionId },
    });
  }

  async validateCourse(courseId: number, user: Admin) {
    this.admin(user);
    await this.course(courseId);
    const lessons = await this.prisma.courseLesson.findMany({
      where: { courseId },
      include: { sections: true, exercises: { include: { questions: true } } },
      orderBy: { order: 'asc' },
    });
    const errors: string[] = [];
    for (const lesson of lessons) {
      if (!lesson.title.trim())
        errors.push(`Bài học #${lesson.id}: thiếu tiêu đề`);
      if (!lesson.summary.trim())
        errors.push(`Bài học #${lesson.id}: thiếu tóm tắt`);
      if (
        !Array.isArray(lesson.learningObjectives) ||
        lesson.learningObjectives.length === 0
      )
        errors.push(`Bài học #${lesson.id}: thiếu mục tiêu`);
      if (!lesson.sections.some((section) => section.isRequired))
        errors.push(`Bài học #${lesson.id}: thiếu section bắt buộc`);
      const finalCheck = lesson.exercises.find(
        (exercise) => exercise.slug === 'final-check',
      );
      if (!finalCheck) {
        if (lesson.requiresFinalCheck)
          errors.push(`Bài học #${lesson.id}: thiếu Kiểm tra cuối bài`);
      } else if (!finalCheck.questions.length)
        errors.push(`Bài học #${lesson.id}: Kiểm tra cuối bài chưa có câu hỏi`);
      for (const exercise of lesson.exercises)
        if (exercise.required && exercise.questions.length === 0)
          errors.push(`Bài tập “${exercise.title}” chưa có câu hỏi`);
    }
    if (
      !lessons.some((lesson) => lesson.status === CourseLessonStatus.PUBLISHED)
    )
      errors.push('Khóa học cần ít nhất một bài học đã xuất bản');
    return { valid: errors.length === 0, errors, courseId };
  }

  async publishLesson(courseId: number, lessonId: number, user: Admin) {
    this.admin(user);
    const lesson = await this.lesson(courseId, lessonId);
    const validation = await this.collectLessonValidation(lesson.id);
    if (validation.length) throw new BadRequestException(validation.join('; '));
    return this.prisma.courseLesson.update({
      where: { id: lesson.id },
      data: { status: CourseLessonStatus.PUBLISHED },
    });
  }

  async validateLesson(courseId: number, lessonId: number, user: Admin) {
    this.admin(user);
    await this.lesson(courseId, lessonId);
    const errors = await this.collectLessonValidation(lessonId);
    return { valid: errors.length === 0, errors, lessonId };
  }

  async publishCourse(courseId: number, user: Admin) {
    this.admin(user);
    const result = await this.validateCourse(courseId, user);
    if (!result.valid) throw new BadRequestException(result.errors.join('; '));
    return this.courseService.reviewCourse(courseId, 'APPROVE', user);
  }

  async preview(courseId: number, lessonId: number, user: Admin) {
    this.admin(user);
    return this.prisma.courseLesson.findFirst({
      where: { id: lessonId, courseId },
      include: {
        sections: { orderBy: { order: 'asc' } },
        media: true,
        exercises: {
          orderBy: { order: 'asc' },
          include: { questions: { orderBy: { order: 'asc' } } },
        },
      },
    });
  }

  private async collectLessonValidation(lessonId: number) {
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      include: { sections: true, exercises: { include: { questions: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const errors: string[] = [];
    if (!lesson.title.trim()) errors.push('Thiếu tiêu đề');
    if (!lesson.summary.trim()) errors.push('Thiếu tóm tắt');
    if (
      !Array.isArray(lesson.learningObjectives) ||
      lesson.learningObjectives.length === 0
    )
      errors.push('Thiếu mục tiêu học tập');
    if (!lesson.sections.some((section) => section.isRequired))
      errors.push('Thiếu section bắt buộc');
    const finalCheck = lesson.exercises.find(
      (exercise) => exercise.slug === 'final-check',
    );
    if (!finalCheck) {
      if (lesson.requiresFinalCheck) errors.push('Thiếu Kiểm tra cuối bài');
    } else if (!finalCheck.questions.length)
      errors.push('Kiểm tra cuối bài chưa có câu hỏi');
    for (const exercise of lesson.exercises)
      if (exercise.required && !exercise.questions.length)
        errors.push(`Bài tập “${exercise.title}” chưa có câu hỏi`);
    return errors;
  }
  private async lesson(courseId: number, lessonId: number) {
    const row = await this.prisma.courseLesson.findFirst({
      where: { id: lessonId, courseId },
    });
    if (!row) throw new NotFoundException('Lesson not found');
    return row;
  }
  private async exercise(
    courseId: number,
    lessonId: number,
    exerciseId: number,
  ) {
    const row = await this.prisma.courseLessonExercise.findFirst({
      where: { id: exerciseId, lessonId, lesson: { courseId } },
    });
    if (!row) throw new NotFoundException('Exercise not found');
    return row;
  }
  private assertSameIds(current: number[], requested: number[]) {
    if (
      current.length !== requested.length ||
      new Set(current).size !== new Set(requested).size ||
      current.some((id) => !requested.includes(id))
    )
      throw new BadRequestException(
        'Danh sách thứ tự không thuộc cùng một cha',
      );
  }
  private validateSection(dto: { heading: string; content: unknown }) {
    if (
      !dto.heading.trim() ||
      dto.content === undefined ||
      dto.content === null
    )
      throw new BadRequestException('Section cần tiêu đề và nội dung');
  }
  private validateQuestion(
    type: CourseLessonExerciseType,
    dto: {
      prompt: string;
      options?: unknown;
      correctAnswer: unknown;
      explanation: string;
    },
  ) {
    if (
      !dto.prompt.trim() ||
      !dto.explanation.trim() ||
      dto.correctAnswer === undefined ||
      dto.correctAnswer === null
    )
      throw new BadRequestException('Câu hỏi thiếu trường bắt buộc');
    const choiceTypes: CourseLessonExerciseType[] = [
      CourseLessonExerciseType.MULTIPLE_CHOICE,
      CourseLessonExerciseType.MULTI_SELECT,
      CourseLessonExerciseType.TRUE_FALSE,
    ];
    if (choiceTypes.includes(type)) {
      if (
        !Array.isArray(dto.options) ||
        dto.options.length < 2 ||
        dto.options.some((item) => item === '')
      )
        throw new BadRequestException(
          'Câu hỏi trắc nghiệm cần ít nhất hai lựa chọn',
        );
      const options = dto.options as unknown[];
      const answers = Array.isArray(dto.correctAnswer)
        ? dto.correctAnswer
        : [dto.correctAnswer];
      if (
        answers.some(
          (answer) =>
            !options.some(
              (option) => JSON.stringify(option) === JSON.stringify(answer),
            ),
        )
      )
        throw new BadRequestException('Đáp án đúng không nằm trong lựa chọn');
    }
  }
}
