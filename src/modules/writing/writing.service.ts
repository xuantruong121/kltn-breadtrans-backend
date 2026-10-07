import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizType, TopicCategory } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';

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
  ) {}

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
    const isEssayTask = ['PROPOSAL', 'OPINION', 'ESSAY'].includes(
      content.taskType,
    );

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
      } else if (['PROPOSAL', 'OPINION', 'ESSAY'].includes(content.taskType)) {
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

    const feedback = JSON.stringify({
      feedback: evaluation.feedback,
      suggestions: evaluation.suggestions,
      maxScore: evaluation.maxScore,
      taskType: content.taskType ?? null,
    });

    // Save submission
    const submission = await this.prisma.submission.create({
      data: {
        quizId,
        userId,
        score: evaluation.score,
        aiFeedback: feedback,
        results: {
          create: [
            {
              questionId: question.id,
              answer,
              score: evaluation.score,
            },
          ],
        },
      },
    });

    return {
      submissionId: submission.id,
      score: evaluation.score,
      maxScore: evaluation.maxScore,
      feedback: evaluation.feedback,
      suggestions: evaluation.suggestions,
      taskType: content.taskType ?? null,
    };
  }

  async submitWritingPart2(
    emailPrompt: string,
    userId: number,
    userResponse: string,
  ) {
    const evaluation = await this.aiService.evaluateWritingPart2(
      emailPrompt,
      userResponse,
    );

    return {
      score: evaluation.score,
      maxScore: 4,
      feedback: evaluation.feedback,
      suggestions: evaluation.suggestions,
    };
  }

  async submitWritingPart3(
    essayTopic: string,
    userId: number,
    userEssay: string,
  ) {
    const evaluation = await this.aiService.evaluateWritingPart3(
      essayTopic,
      userEssay,
    );

    return {
      score: evaluation.score,
      maxScore: 5,
      feedback: evaluation.feedback,
      suggestions: evaluation.suggestions,
    };
  }
}
