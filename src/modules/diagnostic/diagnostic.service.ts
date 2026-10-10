import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildSkillProfiles,
  buildStrengthsAndWeaknesses,
  DiagnosticQuestionForScoring,
  getQuestionMeta,
  getQuestionOptions,
  isOpenDiagnosticQuestion,
  rankCourseRecommendations,
  resolvePlacementLevel,
  resolveEstimatedLevel,
  validateQuestionBank,
} from './diagnostic.logic';
import { Prisma } from '@prisma/client';
import { buildCourseCurriculum } from '../course/course-curriculum';

type AnswerMap = Record<string, unknown>;

@Injectable()
export class DiagnosticService {
  constructor(private readonly prisma: PrismaService) {}

  private assertQuestionBank(questions: DiagnosticQuestionForScoring[]) {
    const defects = validateQuestionBank(questions);
    if (defects.length > 0) {
      throw new InternalServerErrorException(
        'Bài kiểm tra đầu vào chưa sẵn sàng để chấm điểm',
      );
    }
  }

  private formQuestions(questions: DiagnosticQuestionForScoring[]) {
    return questions.filter(
      (question) => getQuestionMeta(question).activeInForm !== false,
    );
  }

  private sanitizeQuestion(question: DiagnosticQuestionForScoring) {
    const meta = getQuestionMeta(question);
    return {
      id: question.id,
      skill: question.skill,
      section: meta.section ?? question.skill,
      construct: meta.construct ?? null,
      questionType: meta.questionType ?? 'MCQ',
      question: question.question,
      options: getQuestionOptions(question),
      passageText:
        meta.section === 'READING' ? (meta.passageText ?? null) : null,
      audioUrl: meta.section === 'LISTENING' ? (meta.audioUrl ?? null) : null,
      order: question.order,
    };
  }

  private async recommendations(level: string, weaknesses: string[]) {
    const courses = await this.prisma.course.findMany({
      where: { status: 'PUBLISHED', lessons: { some: {} } },
      select: {
        id: true,
        title: true,
        description: true,
        level: true,
        status: true,
        curriculumType: true,
        _count: { select: { lessons: true } },
        lessons: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            order: true,
            materials: {
              select: {
                id: true,
                title: true,
                fileUrl: true,
                fileType: true,
                objective: true,
                contentText: true,
              },
            },
          },
        },
        quizzes: {
          where: { publicationStatus: 'PUBLISHED' },
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            publicationStatus: true,
            isPremiumContent: true,
            _count: { select: { questions: true } },
          },
        },
        activities: {
          include: {
            quiz: {
              include: { _count: { select: { questions: true } } },
            },
            speakingPracticeSet: {
              include: { exercises: { select: { id: true } } },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    const ranked = rankCourseRecommendations(
      courses.map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        level: course.level,
        status: course.status,
        lessonCount: course._count.lessons,
        curriculumReady:
          buildCourseCurriculum(
            course.lessons ?? [],
            course.quizzes ?? [],
            course.activities ?? [],
            course.curriculumType,
          ).readiness === 'READY',
      })),
      level,
      weaknesses,
    );
    return ranked.map((recommendation) => {
      const course = courses.find(
        (candidate) => candidate.id === recommendation.courseId,
      );
      const lesson =
        course?.lessons.find((candidate) => {
          const text =
            `${candidate.title} ${candidate.description ?? ''} ${candidate.materials.map((material) => `${material.title} ${material.objective ?? ''}`).join(' ')}`.toLowerCase();
          return (
            weaknesses.some((weakness) =>
              text.includes(weakness.toLowerCase()),
            ) ||
            weaknesses.some(
              (weakness) =>
                weakness === 'Grammar' && /grammar|ngữ pháp/.test(text),
            ) ||
            weaknesses.some(
              (weakness) =>
                weakness === 'Vocabulary' && /vocabulary|từ vựng/.test(text),
            )
          );
        }) ?? course?.lessons[0];
      return {
        ...recommendation,
        recommendedLesson: lesson
          ? { id: lesson.id, title: lesson.title }
          : null,
        advisoryOnly: true,
      };
    });
  }

  private async toResult(
    attempt: {
      id: number;
      answers: unknown;
      correctCount: number;
      totalCount: number;
      percentage: number;
      level: string;
      submittedAt: Date;
    },
    questions: DiagnosticQuestionForScoring[],
  ) {
    const answers = this.readAnswerMap(attempt.answers);
    const objectiveQuestions = questions.filter(
      (question) => !isOpenDiagnosticQuestion(question),
    );
    const productiveTaskCount = questions.length - objectiveQuestions.length;
    const profiles = buildSkillProfiles(objectiveQuestions, answers);
    const { strengths, weaknesses } = buildStrengthsAndWeaknesses(profiles);
    return {
      attemptId: attempt.id,
      correctCount: attempt.correctCount,
      totalCount: attempt.totalCount,
      objectiveTotalCount: objectiveQuestions.length,
      productiveTaskCount,
      productiveUnavailable: productiveTaskCount > 0,
      percentage: attempt.percentage,
      level: attempt.level,
      submittedAt: attempt.submittedAt,
      skillProfiles: profiles,
      strengths,
      weaknesses,
      recommendations: await this.recommendations(attempt.level, weaknesses),
      questionsResult: questions.map((question) => {
        const selectedOption = answers[String(question.id)];
        const open = isOpenDiagnosticQuestion(question);
        return {
          questionId: question.id,
          selectedOption:
            typeof selectedOption === 'number' ? selectedOption : undefined,
          selectedText:
            typeof selectedOption === 'string' ? selectedOption : undefined,
          correctOption: open ? null : question.correctIndex,
          isCorrect: open ? null : selectedOption === question.correctIndex,
          explanation: open ? null : question.explanation,
        };
      }),
    };
  }

  private readAnswerMap(value: unknown): AnswerMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as AnswerMap;
  }

  async getCurrentAssessment(userId: number) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { isActive: true },
      orderBy: { id: 'desc' },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    if (!assessment)
      throw new NotFoundException('Chưa có bài kiểm tra đầu vào');
    this.assertQuestionBank(assessment.questions);
    const formQuestions = this.formQuestions(assessment.questions);

    const latestAttempt = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId: assessment.id },
      orderBy: { submittedAt: 'desc' },
    });
    return {
      id: assessment.id,
      title: assessment.title,
      description: assessment.description,
      questions: formQuestions.map((question) =>
        this.sanitizeQuestion(question),
      ),
      latestAttempt: latestAttempt
        ? {
            correctCount: latestAttempt.correctCount,
            totalCount: latestAttempt.totalCount,
            percentage: latestAttempt.percentage,
            level: latestAttempt.level,
            submittedAt: latestAttempt.submittedAt,
          }
        : null,
    };
  }

  async getLatestResult(userId: number) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { isActive: true },
      orderBy: { id: 'desc' },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!assessment)
      throw new NotFoundException('Chưa có bài kiểm tra đầu vào');
    this.assertQuestionBank(assessment.questions);
    const formQuestions = this.formQuestions(assessment.questions);
    const attempt = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId: assessment.id },
      orderBy: { submittedAt: 'desc' },
    });
    return attempt ? this.toResult(attempt, formQuestions) : null;
  }

  async submitAssessment(
    userId: number,
    assessmentId: number,
    answers: unknown,
    submissionToken?: string,
  ) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { id: assessmentId, isActive: true },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!assessment) {
      throw new NotFoundException(
        'Bài kiểm tra không tồn tại hoặc đã ngừng hoạt động',
      );
    }
    this.assertQuestionBank(assessment.questions);
    const formQuestions = this.formQuestions(assessment.questions);
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new BadRequestException('Câu trả lời không hợp lệ');
    }

    const answerMap = answers as AnswerMap;
    const expectedIds = new Set(
      formQuestions.map((question) => String(question.id)),
    );
    const submittedIds = Object.keys(answerMap);
    const unknownIds = submittedIds.filter((id) => !expectedIds.has(id));
    const missingIds = [...expectedIds].filter((id) => !(id in answerMap));
    if (unknownIds.length || missingIds.length) {
      throw new BadRequestException(
        `Cần trả lời đúng ${formQuestions.length} câu hỏi hiện tại`,
      );
    }
    for (const question of formQuestions) {
      const selectedOption = answerMap[String(question.id)];
      if (isOpenDiagnosticQuestion(question)) {
        if (
          typeof selectedOption !== 'string' ||
          selectedOption.trim().length < 2 ||
          selectedOption.length > 2000
        )
          throw new BadRequestException('Câu trả lời tự luận không hợp lệ');
      } else {
        const options = getQuestionOptions(question);
        if (
          !Number.isInteger(selectedOption) ||
          (selectedOption as number) < 0 ||
          (selectedOption as number) >= options.length
        ) {
          throw new BadRequestException(
            'Có câu trả lời không thuộc lựa chọn hiện tại',
          );
        }
      }
    }

    const questionsResult = formQuestions.map((question) => {
      const selectedOption = answerMap[String(question.id)] as number;
      const open = isOpenDiagnosticQuestion(question);
      return {
        questionId: question.id,
        selectedOption: open ? undefined : selectedOption,
        selectedText: open
          ? String(answerMap[String(question.id)] ?? '')
          : undefined,
        correctOption: open ? null : question.correctIndex,
        isCorrect: open ? null : selectedOption === question.correctIndex,
        explanation: open ? null : question.explanation,
      };
    });
    const objectiveQuestions = formQuestions.filter(
      (question) => !isOpenDiagnosticQuestion(question),
    );
    const correctCount = questionsResult.filter(
      (item) => item.isCorrect === true,
    ).length;
    const totalCount = objectiveQuestions.length;
    const percentage =
      totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 100);
    const v2 =
      assessment.id === 2 || assessment.title.toLowerCase().includes('v2');
    const level = v2
      ? resolvePlacementLevel(
          {
            LANGUAGE_USE: this.sectionPercentage(
              formQuestions,
              answerMap,
              'LANGUAGE_USE',
            ),
            READING: this.sectionPercentage(
              formQuestions,
              answerMap,
              'READING',
            ),
            LISTENING: this.sectionPercentage(
              formQuestions,
              answerMap,
              'LISTENING',
            ),
            CORE: this.weightedCore(formQuestions, answerMap),
          },
          this.bandPercentages(formQuestions, answerMap),
        )
      : resolveEstimatedLevel(percentage);
    const previousAttempts = await this.prisma.diagnosticAttempt.count({
      where: { userId },
    });

    const attempt = await this.prisma.$transaction(async (tx) => {
      if (submissionToken) {
        const recent = await tx.diagnosticAttempt.findFirst({
          where: { userId, assessmentId },
          orderBy: { submittedAt: 'desc' },
        });
        const recentAnswers = this.readAnswerMap(recent?.answers);
        if (recent && recentAnswers.__submissionToken === submissionToken)
          return recent;
      }
      const storedAnswers = submissionToken
        ? { ...answerMap, __submissionToken: submissionToken }
        : answerMap;
      const created = await tx.diagnosticAttempt.create({
        data: {
          userId,
          assessmentId,
          answers: storedAnswers as Prisma.InputJsonObject,
          correctCount,
          totalCount,
          percentage,
          level,
        },
      });
      await tx.learningActivity.create({
        data: {
          userId,
          type: 'DIAGNOSTIC',
          title: assessment.title,
          detail: `${correctCount}/${totalCount} câu đúng • ${level}`,
          score: percentage,
          sourceType: 'DiagnosticAttempt',
          sourceId: String(created.id),
        },
      });
      if (previousAttempts === 0) {
        await tx.userStats.upsert({
          where: { userId },
          update: { totalBanhRan: { increment: 50 } },
          create: { userId, totalBanhRan: 50 },
        });
      }
      return created;
    });

    return this.toResult(attempt, formQuestions);
  }

  private sectionPercentage(
    questions: DiagnosticQuestionForScoring[],
    answers: AnswerMap,
    section: string,
  ) {
    const items = questions.filter(
      (question) =>
        getQuestionMeta(question).section === section &&
        !isOpenDiagnosticQuestion(question),
    );
    if (!items.length) return 0;
    return Math.round(
      (items.filter(
        (question) => answers[String(question.id)] === question.correctIndex,
      ).length /
        items.length) *
        100,
    );
  }

  private weightedCore(
    questions: DiagnosticQuestionForScoring[],
    answers: AnswerMap,
  ) {
    return Math.round(
      this.sectionPercentage(questions, answers, 'LANGUAGE_USE') * 0.4 +
        this.sectionPercentage(questions, answers, 'READING') * 0.3 +
        this.sectionPercentage(questions, answers, 'LISTENING') * 0.3,
    );
  }

  private bandPercentages(
    questions: DiagnosticQuestionForScoring[],
    answers: AnswerMap,
  ) {
    const result: Record<string, number> = {};
    for (const band of ['A1', 'A2', 'B1', 'B2']) {
      const items = questions.filter(
        (question) =>
          getQuestionMeta(question).intendedLevel === band &&
          !isOpenDiagnosticQuestion(question),
      );
      result[band] = items.length
        ? Math.round(
            (items.filter(
              (question) =>
                answers[String(question.id)] === question.correctIndex,
            ).length /
              items.length) *
              100,
          )
        : 0;
    }
    return result;
  }
}
