import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';
import { WritingService } from './writing.service';
import { QuizType, TopicCategory } from '@prisma/client';

describe('Writing premium content boundary', () => {
  const quiz = {
    id: 9,
    title: 'Premium writing',
    description: 'Premium description',
    type: QuizType.WRITING_EMAIL,
    isPremiumContent: true,
    courseId: null,
    practiceTopicId: 3,
    practiceTopic: {
      id: 3,
      name: 'Writing',
      category: TopicCategory.WRITING_PART2,
    },
    questions: [
      { id: 90, content: { prompt: 'Premium prompt', taskType: 'EMAIL' } },
    ],
  };
  const access = {
    assertAccess: jest.fn(),
    resolveMany: jest.fn(),
  } as unknown as QuizContentAccessService;
  const prisma = {
    practiceTopic: { findMany: jest.fn() },
    quiz: { findMany: jest.fn(), findUnique: jest.fn() },
    submission: { findMany: jest.fn() },
  };
  const ai = {
    evaluateWritingPart2: jest.fn(),
    evaluateWritingPart3: jest.fn(),
    evaluateWritingPart1: jest.fn(),
  };
  let service: WritingService;

  beforeEach(() => {
    jest.clearAllMocks();
    (access.assertAccess as unknown as jest.Mock).mockRejectedValue(
      new ForbiddenException({
        error: {
          code: 'FEATURE_NOT_INCLUDED',
          featureKey: 'PREMIUM_WRITING_CONTENT',
        },
      }),
    );
    (access.resolveMany as unknown as jest.Mock).mockResolvedValue(
      new Map([[9, { isPremiumContent: true, isLocked: true }]]),
    );
    prisma.quiz.findUnique.mockResolvedValue(quiz);
    prisma.quiz.findMany.mockResolvedValue([quiz]);
    prisma.practiceTopic.findMany.mockResolvedValue([]);
    prisma.submission.findMany.mockResolvedValue([]);
    service = new WritingService(
      prisma as unknown as PrismaService,
      ai as unknown as AiService,
      access,
    );
  });

  it('returns safe locked list metadata without a premium prompt', async () => {
    const result = await service.getTopics(7);
    expect(result.quizzes[0]).toMatchObject({
      isPremiumContent: true,
      isLocked: true,
    });
    expect(result.quizzes[0]).not.toHaveProperty('prompt');
  });

  it('denies premium detail before prompt serialization', async () => {
    await expect(service.getQuizDetails(9, 7)).rejects.toMatchObject({
      response: { error: { code: 'FEATURE_NOT_INCLUDED' } },
    });
  });

  it('denies quiz submission before invoking the AI provider', async () => {
    await expect(
      service.submitWriting(9, 7, 'my answer'),
    ).rejects.toMatchObject({
      response: { error: { code: 'FEATURE_NOT_INCLUDED' } },
    });
    expect(ai.evaluateWritingPart2).not.toHaveBeenCalled();
    expect(ai.evaluateWritingPart3).not.toHaveBeenCalled();
  });
});
