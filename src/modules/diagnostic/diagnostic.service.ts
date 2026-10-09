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
  rankCourseRecommendations,
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

  private sanitizeQuestion(question: DiagnosticQuestionForScoring) {
    const options = Array.isArray(question.options)
      ? question.options.filter(
          (option): option is string => typeof option === 'string',
        )
      : [];
    return {
      id: question.id,
      skill: question.skill,
      question: question.question,
      options,
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
    return rankCourseRecommendations(
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
    const profiles = buildSkillProfiles(questions, answers);
    const { strengths, weaknesses } = buildStrengthsAndWeaknesses(profiles);
    return {
      attemptId: attempt.id,
      correctCount: attempt.correctCount,
      totalCount: attempt.totalCount,
      percentage: attempt.percentage,
      level: attempt.level,
      submittedAt: attempt.submittedAt,
      skillProfiles: profiles,
      strengths,
      weaknesses,
      recommendations: await this.recommendations(attempt.level, weaknesses),
      questionsResult: questions.map((question) => {
        const selectedOption = answers[String(question.id)];
        return {
          questionId: question.id,
          selectedOption:
            typeof selectedOption === 'number' ? selectedOption : undefined,
          correctOption: question.correctIndex,
          isCorrect: selectedOption === question.correctIndex,
          explanation: question.explanation,
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

    const latestAttempt = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId: assessment.id },
      orderBy: { submittedAt: 'desc' },
    });
    return {
      id: assessment.id,
      title: assessment.title,
      description: assessment.description,
      questions: assessment.questions.map((question) =>
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
    const attempt = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId: assessment.id },
      orderBy: { submittedAt: 'desc' },
    });
    return attempt ? this.toResult(attempt, assessment.questions) : null;
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
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new BadRequestException('Câu trả lời không hợp lệ');
    }

    const answerMap = answers as AnswerMap;
    const expectedIds = new Set(
      assessment.questions.map((question) => String(question.id)),
    );
    const submittedIds = Object.keys(answerMap);
    const unknownIds = submittedIds.filter((id) => !expectedIds.has(id));
    const missingIds = [...expectedIds].filter((id) => !(id in answerMap));
    if (unknownIds.length || missingIds.length) {
      throw new BadRequestException(
        `Cần trả lời đúng ${assessment.questions.length} câu hỏi hiện tại`,
      );
    }
    for (const question of assessment.questions) {
      const selectedOption = answerMap[String(question.id)];
      if (
        !Number.isInteger(selectedOption) ||
        (selectedOption as number) < 0 ||
        (selectedOption as number) >= (question.options as unknown[]).length
      ) {
        throw new BadRequestException(
          'Có câu trả lời không thuộc lựa chọn hiện tại',
        );
      }
    }

    const questionsResult = assessment.questions.map((question) => {
      const selectedOption = answerMap[String(question.id)] as number;
      return {
        questionId: question.id,
        selectedOption,
        correctOption: question.correctIndex,
        isCorrect: selectedOption === question.correctIndex,
        explanation: question.explanation,
      };
    });
    const correctCount = questionsResult.filter(
      (item) => item.isCorrect,
    ).length;
    const totalCount = assessment.questions.length;
    const percentage =
      totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 100);
    const level = resolveEstimatedLevel(percentage);
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

    return this.toResult(attempt, assessment.questions);
  }
}
