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
    const summaries = lessons.map((lesson) => {
      const completed =
        lesson.exercises.length === 0 ||
        lesson.exercises.every((exercise) =>
          this.everPassed(attempts, exercise.id, exercise.minimumScore),
        );
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
        // Research provenance is authoring-only. Learner lessons are self-contained
        // and must not expose external learning links.
        references: [],
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
          completed: this.everPassed(
            attempts,
            exercise.id,
            exercise.minimumScore,
          ),
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
    for (const question of exercise.questions) {
      const answer = answerById.get(question.id);
      if (Array.isArray(question.options) && question.options.length > 0) {
        const isKnownOption = question.options.some((option) =>
          this.answersEqual(answer, option),
        );
        if (!isKnownOption) {
          throw new BadRequestException(
            `Lựa chọn không hợp lệ cho câu hỏi ${question.order}`,
          );
        }
      }
    }
    // Free-text items ("Viết một câu giới thiệu nơi bạn đến") have many valid
    // answers but store a single model answer. Grading them by exact match
    // marked "I am from Can Tho." wrong against "I am from Hanoi.", and since a
    // required exercise needs 100%, lessons could not be completed honestly.
    // They must be answered, are returned with the model answer for
    // self-review, and do not count toward the score.
    for (const question of exercise.questions) {
      if (this.isOpenQuestion(question)) {
        const answer = answerById.get(question.id);
        if (typeof answer !== 'string' || answer.trim().length === 0) {
          throw new BadRequestException(
            `Hãy viết câu trả lời cho câu hỏi ${question.order}`,
          );
        }
      }
    }
    const graded = exercise.questions.map((question) => {
      const rawAnswer = answerById.get(question.id);
      const answer = rawAnswer === undefined ? null : rawAnswer;
      if (this.isOpenQuestion(question)) {
        return {
          questionId: question.id,
          answer,
          isCorrect: null,
          score: null,
          explanation: question.explanation,
        };
      }
      const isCorrect = this.answersEqual(answer, question.correctAnswer);
      return {
        questionId: question.id,
        answer,
        isCorrect,
        score: isCorrect ? 1 : 0,
        explanation: question.explanation,
      };
    });
    const score = graded.reduce((sum, answer) => sum + (answer.score ?? 0), 0);
    const maxScore = exercise.questions.filter(
      (question) => !this.isOpenQuestion(question),
    ).length;
    const attempt = await this.prisma.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') {
        const lockKey = BigInt(user.id) * 1_000_003n + BigInt(exerciseId);
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`,
        );
      }
      if (typeof tx.courseLessonAttempt.findFirst === 'function') {
        const existing = await tx.courseLessonAttempt.findFirst({
          where: {
            userId: user.id,
            lessonId,
            exerciseId,
            status: CourseLessonAttemptStatus.SUBMITTED,
          },
          orderBy: { createdAt: 'desc' },
          include: { answers: true },
        });
        if (
          existing &&
          this.submissionMatches(
            existing.answers,
            answerById,
            exercise.questions,
          )
        ) {
          return existing;
        }
      }
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
      feedback: graded.map(({ questionId, isCorrect, explanation }) => ({
        questionId,
        answer: answerById.get(questionId) ?? null,
        correctAnswer: exercise.questions.find(
          (question) => question.id === questionId,
        )?.correctAnswer,
        isCorrect,
        explanation,
      })),
    };
  }

  private submissionMatches(
    persisted: Array<{ questionId: number; answer: Prisma.JsonValue }>,
    submitted: Map<number, unknown>,
    questions: Array<{ id: number }>,
  ) {
    if (persisted.length !== questions.length) return false;
    return questions.every((question) =>
      this.answersEqual(
        persisted.find((answer) => answer.questionId === question.id)?.answer,
        submitted.get(question.id),
      ),
    );
  }

  /**
   * Completion is earned once and kept: a later, weaker retry is practice and
   * must not take back a lesson the learner already passed. Judging only the
   * latest attempt made course progress go backwards after a review retry.
   */
  private everPassed(
    attempts: Array<{
      exerciseId: number;
      score: number | null;
      maxScore: number | null;
    }>,
    exerciseId: number,
    minimumScore: number | null,
  ) {
    return attempts.some(
      (attempt) =>
        attempt.exerciseId === exerciseId &&
        this.isSuccessful(attempt.score, attempt.maxScore, minimumScore),
    );
  }

  /** A question without options is answered in the learner's own words. */
  private isOpenQuestion(question: { options: Prisma.JsonValue | null }) {
    return !Array.isArray(question.options) || question.options.length === 0;
  }

  private isSuccessful(
    score: number | null,
    maxScore: number | null,
    minimumScore?: number | null,
  ) {
    if (score === null || maxScore === null || maxScore < 0) return false;
    // Every item was free text: a submitted attempt (all answered) completes it.
    if (maxScore === 0) return score === 0;
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

  private answersEqual(left: unknown, right: unknown) {
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
