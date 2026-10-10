import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseLessonAttemptStatus,
  CourseLessonStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseService } from './course.service';
import { SubmitCourseLessonExerciseDto } from './course-v5.dto';

type CourseUser = { id: number; role: Role };

@Injectable()
export class CourseLearningV5Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courseService: CourseService,
  ) {}

  private async assertAccess(courseId: number, user: CourseUser) {
    const course = await this.courseService.getCourseById(
      courseId,
      user.id,
      user.role,
    );
    if (!('canAccess' in course) || !course.canAccess) {
      throw new ForbiddenException('Khóa học này cần quyền truy cập hợp lệ');
    }
    return course;
  }

  async getOverview(courseId: number, user: CourseUser) {
    const course = await this.assertAccess(courseId, user);
    const lessons = await this.prisma.courseLesson.findMany({
      where: { courseId, status: CourseLessonStatus.PUBLISHED },
      orderBy: { order: 'asc' },
      include: {
        exercises: {
          where: { required: true },
          select: { id: true, minimumScore: true },
        },
      },
    });
    const attempts = await this.prisma.courseLessonAttempt.findMany({
      where: {
        userId: user.id,
        lessonId: { in: lessons.map((lesson) => lesson.id) },
        status: CourseLessonAttemptStatus.SUBMITTED,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        lessonId: true,
        exerciseId: true,
        score: true,
        maxScore: true,
      },
    });
    const latest = new Map<number, (typeof attempts)[number]>();
    for (const attempt of attempts) {
      if (!latest.has(attempt.exerciseId))
        latest.set(attempt.exerciseId, attempt);
    }
    const summaries = lessons.map((lesson) => {
      const completed =
        lesson.exercises.length === 0 ||
        lesson.exercises.every((exercise) => {
          const attempt = latest.get(exercise.id);
          return Boolean(
            attempt &&
            this.isSuccessful(
              attempt.score,
              attempt.maxScore,
              exercise.minimumScore,
            ),
          );
        });
      return {
        id: lesson.id,
        slug: lesson.slug,
        order: lesson.order,
        title: lesson.title,
        summary: lesson.summary,
        estimatedMinutes: lesson.estimatedMinutes,
        difficulty: lesson.difficulty,
        coverImage: lesson.coverImage,
        exerciseCount: lesson.exercises.length,
        completed,
      };
    });
    const completedLessons = summaries.filter(
      (lesson) => lesson.completed,
    ).length;
    return {
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        level: course.level,
        learning: 'learning' in course ? course.learning : undefined,
      },
      lessons: summaries,
      progress: {
        completedLessons,
        totalLessons: summaries.length,
        percentage: summaries.length
          ? Math.round((completedLessons / summaries.length) * 100)
          : 0,
        isComplete:
          summaries.length > 0 && completedLessons === summaries.length,
      },
    };
  }

  async getLesson(courseId: number, lessonId: number, user: CourseUser) {
    const course = await this.assertAccess(courseId, user);
    const lesson = await this.prisma.courseLesson.findFirst({
      where: { id: lessonId, courseId, status: CourseLessonStatus.PUBLISHED },
      include: {
        sections: { orderBy: { order: 'asc' } },
        exercises: {
          orderBy: { order: 'asc' },
          include: { questions: { orderBy: { order: 'asc' } } },
        },
        references: true,
        media: true,
      },
    });
    if (!lesson) throw new NotFoundException('Course lesson not found');
    const allLessons = await this.prisma.courseLesson.findMany({
      where: { courseId, status: CourseLessonStatus.PUBLISHED },
      orderBy: { order: 'asc' },
      select: { id: true, order: true, title: true },
    });
    const index = allLessons.findIndex((item) => item.id === lessonId);
    const attempts = await this.prisma.courseLessonAttempt.findMany({
      where: {
        userId: user.id,
        lessonId,
        status: CourseLessonAttemptStatus.SUBMITTED,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        exerciseId: true,
        score: true,
        maxScore: true,
        submittedAt: true,
      },
    });
    const latest = new Map<number, (typeof attempts)[number]>();
    for (const attempt of attempts)
      if (!latest.has(attempt.exerciseId))
        latest.set(attempt.exerciseId, attempt);
    return {
      courseId,
      course: {
        id: course.id,
        title: course.title,
        level: course.level,
        learning: 'learning' in course ? course.learning : undefined,
      },
      lesson: {
        id: lesson.id,
        slug: lesson.slug,
        order: lesson.order,
        title: lesson.title,
        summary: lesson.summary,
        learningObjectives: lesson.learningObjectives,
        estimatedMinutes: lesson.estimatedMinutes,
        difficulty: lesson.difficulty,
        coverImage: lesson.coverImage,
        sections: lesson.sections,
        media: lesson.media,
        references: lesson.references,
        exercises: lesson.exercises.map((exercise) => ({
          id: exercise.id,
          slug: exercise.slug,
          order: exercise.order,
          type: exercise.type,
          title: exercise.title,
          prompt: exercise.prompt,
          instructions: exercise.instructions,
          content: this.learnerContent(exercise.content),
          rubric: exercise.rubric,
          required: exercise.required,
          minimumScore: exercise.minimumScore,
          questions: exercise.questions.map((question) => ({
            id: question.id,
            order: question.order,
            prompt: question.prompt,
            options: question.options,
          })),
          completed: (() => {
            const attempt = latest.get(exercise.id);
            return Boolean(
              attempt &&
              this.isSuccessful(
                attempt.score,
                attempt.maxScore,
                exercise.minimumScore,
              ),
            );
          })(),
        })),
      },
      navigation: {
        previousLessonId: index > 0 ? allLessons[index - 1].id : null,
        nextLessonId:
          index >= 0 && index < allLessons.length - 1
            ? allLessons[index + 1].id
            : null,
        lessons: allLessons,
      },
    };
  }

  async submitExercise(
    courseId: number,
    lessonId: number,
    exerciseId: number,
    user: CourseUser,
    dto: SubmitCourseLessonExerciseDto,
  ) {
    await this.assertAccess(courseId, user);
    const exercise = await this.prisma.courseLessonExercise.findFirst({
      where: {
        id: exerciseId,
        lessonId,
        lesson: { courseId, status: CourseLessonStatus.PUBLISHED },
      },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!exercise) throw new NotFoundException('Course exercise not found');
    if (!Array.isArray(dto.answers))
      throw new BadRequestException('Danh sách câu trả lời không hợp lệ');
    const answers = dto.answers;
    const ids = answers.map((answer) => Number(answer.questionId));
    if (
      ids.some((id) => !Number.isInteger(id)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new BadRequestException('Câu trả lời bị trùng hoặc không hợp lệ');
    }
    const expected = new Set(exercise.questions.map((question) => question.id));
    if (
      answers.length !== exercise.questions.length ||
      ids.some((id) => !expected.has(id))
    ) {
      throw new BadRequestException(
        'Phải trả lời đúng toàn bộ câu hỏi của bài tập',
      );
    }
    const answerById = new Map(
      answers.map((answer) => [Number(answer.questionId), answer.answer]),
    );
    const graded = exercise.questions.map((question) => {
      const rawAnswer = answerById.get(question.id);
      const answer = rawAnswer === undefined ? null : rawAnswer;
      const isCorrect = this.answersEqual(answer, question.correctAnswer);
      return {
        questionId: question.id,
        answer,
        isCorrect,
        score: isCorrect ? 1 : 0,
        explanation: question.explanation,
      };
    });
    const score = graded.reduce((sum, answer) => sum + answer.score, 0);
    const maxScore = exercise.questions.length;
    const attempt = await this.prisma.$transaction(async (tx) => {
      const created = await tx.courseLessonAttempt.create({
        data: {
          userId: user.id,
          lessonId,
          exerciseId,
          status: CourseLessonAttemptStatus.SUBMITTED,
          score,
          maxScore,
          submittedAt: new Date(),
          answers: {
            create: graded.map(
              ({ questionId, answer, isCorrect, score: answerScore }) => ({
                questionId,
                answer: answer as Prisma.InputJsonValue,
                isCorrect,
                score: answerScore,
              }),
            ),
          },
        },
      });
      return created;
    });
    return {
      attemptId: attempt.id,
      score,
      maxScore,
      percentage: maxScore ? Math.round((score / maxScore) * 100) : 0,
      completed: this.isSuccessful(score, maxScore, exercise.minimumScore),
      feedback: graded.map(
        ({ questionId, answer, isCorrect, explanation }) => ({
          questionId,
          answer,
          isCorrect,
          explanation,
        }),
      ),
    };
  }

  private isSuccessful(
    score: number | null,
    maxScore: number | null,
    minimumScore?: number | null,
  ) {
    if (score === null || maxScore === null || maxScore <= 0) return false;
    return minimumScore !== null && minimumScore !== undefined
      ? (score / maxScore) * 100 >= minimumScore
      : score === maxScore;
  }

  /** Keep listening transcripts course-owned without leaking them before submit. */
  private learnerContent(content: Prisma.JsonValue): Prisma.JsonValue {
    if (!content || Array.isArray(content) || typeof content !== 'object') {
      return content;
    }
    const safe = { ...(content as Record<string, Prisma.JsonValue>) };
    delete safe.listeningScript;
    delete safe.transcript;
    return safe;
  }

  private answersEqual(left: unknown, right: Prisma.JsonValue) {
    return (
      JSON.stringify(this.normalizeAnswer(left)) ===
      JSON.stringify(this.normalizeAnswer(right))
    );
  }

  private normalizeAnswer(value: unknown): unknown {
    if (typeof value === 'string') return value.trim().toLocaleLowerCase();
    if (Array.isArray(value))
      return value.map((item) => this.normalizeAnswer(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, this.normalizeAnswer(item)]),
      );
    }
    return value;
  }
}
