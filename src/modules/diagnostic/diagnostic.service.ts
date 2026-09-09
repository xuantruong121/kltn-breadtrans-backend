import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type AnswerMap = Record<string, number>;

@Injectable()
export class DiagnosticService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentAssessment(userId: number) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { isActive: true },
      orderBy: { id: 'desc' },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    if (!assessment)
      throw new NotFoundException('Chưa có bài kiểm tra đầu vào');

    const latestAttempt = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId: assessment.id },
      orderBy: { submittedAt: 'desc' },
    });

    return {
      id: assessment.id,
      title: assessment.title,
      description: assessment.description,
      questions: assessment.questions.map((question) => ({
        id: question.id,
        assessmentId: question.assessmentId,
        skill: question.skill,
        question: question.question,
        options: question.options,
        order: question.order,
      })),
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

  async submitAssessment(
    userId: number,
    assessmentId: number,
    answers: AnswerMap,
  ) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { id: assessmentId, isActive: true },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!assessment)
      throw new NotFoundException(
        'Bài kiểm tra không tồn tại hoặc đã ngừng hoạt động',
      );

    if (!answers || typeof answers !== 'object') {
      throw new BadRequestException('Câu trả lời không hợp lệ');
    }

    const questionsResult = assessment.questions.map((question) => {
      const selectedOption = answers[String(question.id)];
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
    const level =
      percentage >= 75
        ? 'Intermediate'
        : percentage >= 45
          ? 'Foundation'
          : 'Starter';

    const attempt = await this.prisma.$transaction(async (tx) => {
      const created = await tx.diagnosticAttempt.create({
        data: {
          userId,
          assessmentId,
          answers,
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
      return created;
    });

    return {
      attemptId: attempt.id,
      correctCount,
      totalCount,
      percentage,
      level,
      questionsResult,
    };
  }
}
