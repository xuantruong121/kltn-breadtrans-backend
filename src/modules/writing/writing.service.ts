import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizType, TopicCategory } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';

const GENERAL_WRITING_TYPES: QuizType[] = [
  QuizType.WRITING_PICTURE,
  QuizType.WRITING_EMAIL,
];

function isWritingQuiz(quiz: {
  type: QuizType;
  practiceTopic?: { category: TopicCategory } | null;
}) {
  return (
    GENERAL_WRITING_TYPES.includes(quiz.type) &&
    (quiz.practiceTopic?.category === TopicCategory.WRITING_PART1 ||
      quiz.practiceTopic?.category === TopicCategory.WRITING_PART2)
  );
}

@Injectable()
export class WritingService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    @Optional() private readonly quizContentAccess?: QuizContentAccessService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  private async resolveCanonicalTask(
    quizId: number,
    userId: number,
    role: import('@prisma/client').Role | undefined,
    expectedPart: 'PART2' | 'PART3' | 'ANY',
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        practiceTopic: true,
        questions: {
          select: { id: true, content: true },
          orderBy: { order: 'asc' },
          take: 1,
        },
      },
    });

    if (!quiz || !isWritingQuiz(quiz) || quiz.questions.length === 0) {
      throw new NotFoundException('Writing task not found');
    }
    if (expectedPart !== 'ANY' && quiz.type !== QuizType.WRITING_EMAIL) {
      throw new BadRequestException('Bài viết không thuộc Writing Part 2/3');
    }
    await this.assertWritingAccess(quiz, userId, role);

    const question = quiz.questions[0];
    const content = (question.content ?? {}) as Record<string, unknown>;
    const isPart3 = [
      'PROPOSAL',
      'OPINION',
      'ESSAY',
      'OPINION_ESSAY',
      'ANALYTICAL_RESPONSE',
      'ARGUMENT',
    ].includes(String(content.taskType));
    if (
      expectedPart !== 'ANY' &&
      ((expectedPart === 'PART3' && !isPart3) ||
        (expectedPart === 'PART2' && isPart3))
    ) {
      throw new BadRequestException('Bài viết không thuộc đúng phần đánh giá');
    }

    const prompt = String(
      content.prompt ?? quiz.description ?? quiz.title,
    ).trim();
    if (!prompt)
      throw new BadRequestException('Writing task chưa có đề bài hợp lệ');

    return {
      quiz,
      question,
      content,
      prompt,
      isPart3,
      maxScore: isPart3 ? 5 : 4,
    };
  }

  private validateEvaluation(
    evaluation: unknown,
    maxScore: number,
  ): { score: number; feedback: string; suggestions: string[] } {
    if (!evaluation || typeof evaluation !== 'object') {
      throw new ServiceUnavailableException('AI trả về kết quả không hợp lệ');
    }
    const value = evaluation as Record<string, unknown>;
    const score = Number(value.score);
    const feedback = value.feedback;
    const suggestions = value.suggestions;
    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > maxScore ||
      typeof feedback !== 'string' ||
      feedback.trim().length === 0 ||
      feedback.length > 10000 ||
      !Array.isArray(suggestions) ||
      suggestions.length > 30 ||
      suggestions.some((item) => typeof item !== 'string' || item.length > 2000)
    ) {
      throw new ServiceUnavailableException(
        'AI trả về kết quả đánh giá không hợp lệ',
      );
    }
    return {
      score,
      feedback: feedback.trim(),
      suggestions: suggestions
        .map((item) => String(item).trim())
        .filter(Boolean),
    };
  }

  private parsePersistedEvaluation(raw: string | null, maxScore: number) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return this.validateEvaluation(parsed, maxScore);
    } catch {
      return null;
    }
  }

  private async getIdempotentSubmission(
    userId: number,
    quizId: number,
    clientAttemptId?: string,
  ) {
    if (!clientAttemptId) return null;
    return this.prisma.submission.findUnique({
      where: {
        userId_quizId_clientAttemptId: { userId, quizId, clientAttemptId },
      },
      include: { results: true },
    });
  }

  private async persistAssessment(input: {
    quizId: number;
    quizTitle: string;
    quizType: QuizType;
    questionId: number;
    userId: number;
    answer: string;
    clientAttemptId: string;
    evaluation: { score: number; feedback: string; suggestions: string[] };
    maxScore: number;
  }) {
    const feedback = JSON.stringify({
      feedback: input.evaluation.feedback,
      suggestions: input.evaluation.suggestions,
      maxScore: input.maxScore,
      score: input.evaluation.score,
      skill: 'WRITING',
    });
    try {
      const submission = await this.prisma.$transaction(async (tx) => {
        const created = await tx.submission.create({
          data: {
            quizId: input.quizId,
            userId: input.userId,
            clientAttemptId: input.clientAttemptId,
            score: input.evaluation.score,
            aiFeedback: feedback,
            results: {
              create: [
                {
                  questionId: input.questionId,
                  answer: input.answer,
                  score: input.evaluation.score,
                },
              ],
            },
          },
        });
        await tx.learningActivity.create({
          data: {
            userId: input.userId,
            type: 'WRITING_PRACTICE_COMPLETED',
            title: input.quizTitle,
            detail: `${input.evaluation.score}/${input.maxScore} điểm`,
            score: Math.round((input.evaluation.score / input.maxScore) * 100),
            sourceType: 'WRITING_SUBMISSION',
            sourceId: String(created.id),
          },
        });
        return created;
      });

      const rewardInsert = await this.prisma.userQuizReward.createMany({
        data: { userId: input.userId, quizId: input.quizId },
        skipDuplicates: true,
      });
      this.eventEmitter?.emit('quiz.submitted', {
        userId: input.userId,
        quizId: input.quizId,
        score: Math.round((input.evaluation.score / input.maxScore) * 100),
        quizType: input.quizType,
        submissionId: submission.id,
        isFirstSubmission: rewardInsert.count === 1,
      });
      return submission;
    } catch (error) {
      if (this.isClientAttemptConflict(error)) {
        const existing = await this.getIdempotentSubmission(
          input.userId,
          input.quizId,
          input.clientAttemptId,
        );
        if (existing) return existing;
      }
      throw error;
    }
  }

  private isClientAttemptConflict(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: string; meta?: { target?: unknown } };
    const target = candidate.meta?.target;
    return (
      candidate.code === 'P2002' &&
      Array.isArray(target) &&
      target.includes('userId') &&
      target.includes('quizId') &&
      target.includes('clientAttemptId')
    );
  }

  private formatAssessmentResponse(
    submission: { id: number },
    evaluation: { score: number; feedback: string; suggestions: string[] },
    maxScore: number,
    taskType?: unknown,
  ) {
    return {
      submissionId: submission.id,
      status: 'COMPLETED',
      score: evaluation.score,
      maxScore,
      feedback: evaluation.feedback,
      suggestions: evaluation.suggestions,
      taskType: taskType ? String(taskType) : null,
    };
  }

  private async assertWritingAccess(
    quiz: {
      id: number;
      type: QuizType;
      isPremiumContent: boolean;
      courseId: number | null;
    },
    userId?: number,
    role?: import('@prisma/client').Role,
  ) {
    if (this.quizContentAccess) {
      await this.quizContentAccess.assertAccess(quiz, userId, role);
    }
  }

  private async resolveWritingAccess(
    quizzes: Array<{
      id: number;
      type: QuizType;
      isPremiumContent: boolean;
      courseId: number | null;
    }>,
    userId?: number,
    role?: import('@prisma/client').Role,
  ) {
    if (this.quizContentAccess) {
      return this.quizContentAccess.resolveMany(quizzes, userId, role);
    }
    return new Map(
      quizzes.map((quiz) => [
        quiz.id,
        { isPremiumContent: quiz.isPremiumContent, isLocked: false },
      ]),
    );
  }

  async getTopics(userId?: number, role?: import('@prisma/client').Role) {
    const categories = await this.prisma.practiceTopic.findMany({
      where: {
        category: {
          in: [TopicCategory.WRITING_PART1, TopicCategory.WRITING_PART2],
        },
      },
      include: {
        _count: {
          select: { quizzes: true },
        },
      },
    });

    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: { in: GENERAL_WRITING_TYPES },
        practiceTopic: {
          category: {
            in: [TopicCategory.WRITING_PART1, TopicCategory.WRITING_PART2],
          },
        },
      },
      include: {
        questions: {
          select: { content: true },
          orderBy: { order: 'asc' },
          take: 1,
        },
        practiceTopic: true,
      },
      orderBy: { id: 'desc' },
    });

    const userSubmissions = userId
      ? await this.prisma.submission.findMany({
          where: {
            userId,
            quizId: { in: quizzes.map((q) => q.id) },
          },
          select: { quizId: true },
        })
      : [];

    const completedQuizIds = new Set(userSubmissions.map((s) => s.quizId));

    const accessByQuiz = await this.resolveWritingAccess(quizzes, userId, role);

    return {
      categories,
      quizzes: quizzes.map((q) => {
        const question = q.questions[0];
        const content = (question?.content ?? {}) as any;
        const access = accessByQuiz.get(q.id) ?? {
          isPremiumContent: Boolean(q.isPremiumContent),
          isLocked: false,
        };
        const safeMetadata = {
          id: q.id,
          title: q.title,
          description: q.description,
          type: q.type,
          topicId: q.practiceTopicId,
          topicName: q.practiceTopic?.name,
          level: content.level,
          taskType: content.taskType,
          isCompleted: completedQuizIds.has(q.id),
          isPremiumContent: access.isPremiumContent,
          isLocked: access.isLocked,
        };
        if (access.isLocked) return safeMetadata;
        return {
          ...safeMetadata,
          level: content.level,
          taskType: content.taskType,
          prompt: content.prompt,
          imageUrl: content.imageUrl ?? null,
          keywords: Array.isArray(content.keywords)
            ? content.keywords
            : Array.isArray(content.requiredKeywords)
              ? content.requiredKeywords
              : [],
          wordRange: Array.isArray(content.wordRange)
            ? content.wordRange
            : null,
        };
      }),
    };
  }

  async getQuizDetails(
    quizId: number,
    userId?: number,
    role?: import('@prisma/client').Role,
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        practiceTopic: true,
        questions: {
          select: { id: true, content: true },
          orderBy: { order: 'asc' },
          take: 1,
        },
      },
    });

    if (!quiz || !isWritingQuiz(quiz) || quiz.questions.length === 0) {
      throw new NotFoundException('Quiz not found');
    }

    await this.assertWritingAccess(quiz, userId, role);

    const question = quiz.questions[0];
    const content = question.content as any;
    const isEssayTask = [
      'PROPOSAL',
      'OPINION',
      'ESSAY',
      'OPINION_ESSAY',
    ].includes(content.taskType);

    return {
      quizId: quiz.id,
      title: quiz.title,
      description: quiz.description,
      type: quiz.type,
      topicName: quiz.practiceTopic?.name ?? '',
      level: content.level,
      taskType: content.taskType,
      prompt: content.prompt,
      imageUrl: content.imageUrl,
      keywords: Array.isArray(content.keywords)
        ? content.keywords
        : Array.isArray(content.requiredKeywords)
          ? content.requiredKeywords
          : [],
      sampleSentences: content.sampleSentences,
      wordRange: Array.isArray(content.wordRange) ? content.wordRange : null,
      maxScore:
        quiz.type === QuizType.WRITING_PICTURE ? 3 : isEssayTask ? 5 : 4,
    };
  }

  async getCommunitySubmissions(
    quizId: number,
    userId?: number,
    role?: import('@prisma/client').Role,
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        type: true,
        isPremiumContent: true,
        courseId: true,
        practiceTopic: { select: { category: true } },
      },
    });
    if (!quiz || !isWritingQuiz(quiz)) {
      throw new NotFoundException('Quiz not found');
    }
    await this.assertWritingAccess(quiz, userId, role);
    const submissions = await this.prisma.submission.findMany({
      where: { quizId },
      include: {
        user: {
          select: {
            id: true,
            profile: { select: { fullName: true } },
          },
        },
        results: true,
      },
      orderBy: { score: 'desc' },
    });

    return submissions.map((sub) => ({
      id: sub.id,
      user: sub.user.profile?.fullName || 'Học viên',
      score: sub.score,
      answer: sub.results[0]?.answer,
      feedback: sub.aiFeedback,
      submittedAt: sub.submittedAt,
    }));
  }

  async submitWriting(
    quizId: number,
    userId: number,
    text: string,
    role?: import('@prisma/client').Role,
    clientAttemptId?: string,
  ) {
    const answer = text?.trim();
    if (!answer) throw new BadRequestException('Bài viết không được để trống');
    if (answer.length > 20000)
      throw new BadRequestException('Bài viết vượt quá giới hạn cho phép');

    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        practiceTopic: true,
        questions: {
          select: { id: true, content: true },
          orderBy: { order: 'asc' },
          take: 1,
        },
      },
    });
    if (!quiz || !isWritingQuiz(quiz) || quiz.questions.length === 0)
      throw new NotFoundException('Quiz not found');

    await this.assertWritingAccess(quiz, userId, role);

    const question = quiz.questions[0];
    const content = question.content as any;
    const logicalAttemptId = clientAttemptId ?? randomUUID();
    const existing = await this.getIdempotentSubmission(
      userId,
      quizId,
      logicalAttemptId,
    );
    if (existing) {
      const existingMaxScore = [
        'PROPOSAL',
        'OPINION',
        'ESSAY',
        'OPINION_ESSAY',
        'ANALYTICAL_RESPONSE',
        'ARGUMENT',
      ].includes(String(content.taskType))
        ? 5
        : quiz.type === QuizType.WRITING_PICTURE && content.imageUrl
          ? 3
          : 4;
      const existingEvaluation = this.parsePersistedEvaluation(
        existing.aiFeedback,
        existingMaxScore,
      );
      if (!existingEvaluation) {
        throw new ConflictException(
          'Lần nộp bài này đang được xử lý hoặc không hợp lệ',
        );
      }
      return this.formatAssessmentResponse(
        existing,
        existingEvaluation,
        existingMaxScore,
        content.taskType,
      );
    }

    let evaluation: {
      score: number;
      maxScore: number;
      feedback: string;
      suggestions: string[];
    };

    try {
      if (quiz.type === QuizType.WRITING_PICTURE) {
        const result = content.imageUrl
          ? await this.aiService.evaluateWritingPart1(
              content.imageUrl,
              Array.isArray(content.keywords)
                ? content.keywords
                : Array.isArray(content.requiredKeywords)
                  ? content.requiredKeywords
                  : [],
              answer,
            )
          : await this.aiService.evaluateWritingPart2(
              content.prompt ?? quiz.description ?? quiz.title,
              answer,
            );
        evaluation = {
          score: result.score,
          maxScore: content.imageUrl ? 3 : 4,
          feedback: result.feedback,
          suggestions:
            'suggestions' in result && Array.isArray(result.suggestions)
              ? result.suggestions.map(String)
              : [],
        };
      } else if (
        ['PROPOSAL', 'OPINION', 'ESSAY', 'OPINION_ESSAY'].includes(
          content.taskType,
        )
      ) {
        const result = await this.aiService.evaluateWritingPart3(
          content.prompt ?? quiz.description ?? quiz.title,
          answer,
        );
        evaluation = { ...result, maxScore: 5 };
      } else {
        const result = await this.aiService.evaluateWritingPart2(
          content.prompt ?? quiz.description ?? quiz.title,
          answer,
        );
        evaluation = { ...result, maxScore: 4 };
      }
    } catch (error) {
      throw new ServiceUnavailableException(
        'Dịch vụ chấm bài hiện không khả dụng. Bài viết của bạn chưa được lưu điểm; vui lòng thử lại sau.',
        { cause: error as Error },
      );
    }

    const validatedEvaluation = this.validateEvaluation(
      evaluation,
      evaluation.maxScore,
    );
    const submission = await this.persistAssessment({
      quizId,
      quizTitle: quiz.title,
      quizType: quiz.type,
      questionId: question.id,
      userId,
      answer,
      clientAttemptId: logicalAttemptId,
      evaluation: validatedEvaluation,
      maxScore: evaluation.maxScore,
    });
    return this.formatAssessmentResponse(
      submission,
      validatedEvaluation,
      evaluation.maxScore,
      content.taskType,
    );
  }

  async submitWritingPart2(
    quizId: number,
    userId: number,
    userResponse: string,
    role?: import('@prisma/client').Role,
    clientAttemptId?: string,
  ) {
    return this.submitCanonicalWritingAssessment(
      quizId,
      userId,
      userResponse,
      role,
      clientAttemptId,
      'PART2',
    );
  }

  async submitWritingPart3(
    quizId: number,
    userId: number,
    userEssay: string,
    role?: import('@prisma/client').Role,
    clientAttemptId?: string,
  ) {
    return this.submitCanonicalWritingAssessment(
      quizId,
      userId,
      userEssay,
      role,
      clientAttemptId,
      'PART3',
    );
  }

  private async submitCanonicalWritingAssessment(
    quizId: number,
    userId: number,
    answerText: string,
    role: import('@prisma/client').Role | undefined,
    clientAttemptId: string | undefined,
    expectedPart: 'PART2' | 'PART3',
  ) {
    const answer = answerText?.trim();
    if (!answer) throw new BadRequestException('Bài viết không được để trống');
    if (answer.length > 20000) {
      throw new BadRequestException('Bài viết vượt quá giới hạn cho phép');
    }
    const task = await this.resolveCanonicalTask(
      quizId,
      userId,
      role,
      expectedPart,
    );
    const logicalAttemptId = clientAttemptId ?? randomUUID();
    const existing = await this.getIdempotentSubmission(
      userId,
      quizId,
      logicalAttemptId,
    );
    if (existing) {
      const previous = this.parsePersistedEvaluation(
        existing.aiFeedback,
        task.maxScore,
      );
      if (!previous) {
        throw new ConflictException(
          'Lần nộp bài này đang được xử lý hoặc không hợp lệ',
        );
      }
      return this.formatAssessmentResponse(
        existing,
        previous,
        task.maxScore,
        task.content.taskType,
      );
    }

    let evaluation: { score: number; feedback: string; suggestions: string[] };
    try {
      const raw = task.isPart3
        ? await this.aiService.evaluateWritingPart3(task.prompt, answer)
        : await this.aiService.evaluateWritingPart2(task.prompt, answer);
      evaluation = this.validateEvaluation(raw, task.maxScore);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Dịch vụ chấm bài hiện không khả dụng. Bài viết chưa được hoàn tất; hãy thử lại.',
        { cause: error as Error },
      );
    }

    const submission = await this.persistAssessment({
      quizId,
      quizTitle: task.quiz.title,
      quizType: task.quiz.type,
      questionId: task.question.id,
      userId,
      answer,
      clientAttemptId: logicalAttemptId,
      evaluation,
      maxScore: task.maxScore,
    });
    return this.formatAssessmentResponse(
      submission,
      evaluation,
      task.maxScore,
      task.content.taskType,
    );
  }
}
