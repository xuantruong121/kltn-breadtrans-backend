import { ForbiddenException } from '@nestjs/common';
import { QuizType, TopicCategory } from '@prisma/client';
import { WritingService } from './writing.service';

describe('Writing Part 2/3 durable lifecycle', () => {
  const quiz = {
    id: 24,
    title: 'Email practice',
    description: 'Write a response to the email.',
    type: QuizType.WRITING_EMAIL,
    isPremiumContent: false,
    courseId: null,
    practiceTopic: { category: TopicCategory.WRITING_PART2 },
    questions: [
      { id: 240, content: { prompt: 'Canonical prompt', taskType: 'EMAIL' } },
    ],
  };

  const activityCreate = jest.fn();
  const submissionCreate = jest.fn();
  const submissionFindUnique = jest.fn();
  const rewardCreateMany = jest.fn();
  const prisma = {
    quiz: { findUnique: jest.fn().mockResolvedValue(quiz) },
    submission: { findUnique: submissionFindUnique, create: submissionCreate },
    userQuizReward: { createMany: rewardCreateMany },
    learningActivity: { create: activityCreate },
    $transaction: jest.fn((callback: (tx: any) => unknown) =>
      callback({
        submission: { create: submissionCreate },
        learningActivity: { create: activityCreate },
      }),
    ),
  };
  const ai = {
    evaluateWritingPart2: jest.fn().mockResolvedValue({
      score: 3,
      feedback: 'Tốt',
      suggestions: ['Thêm chi tiết'],
    }),
    evaluateWritingPart3: jest.fn(),
  };
  const events = { emit: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    submissionFindUnique.mockResolvedValue(null);
    submissionCreate.mockResolvedValue({ id: 501 });
    activityCreate.mockResolvedValue({ id: 601 });
    rewardCreateMany.mockResolvedValue({ count: 1 });
  });

  it('persists Part 2 submission, result and learning activity', async () => {
    const service = new WritingService(
      prisma as any,
      ai as any,
      undefined,
      events as any,
    );

    const result = await service.submitWritingPart2(
      quiz.id,
      7,
      'My response',
      undefined,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(result).toMatchObject({
      submissionId: 501,
      status: 'COMPLETED',
      score: 3,
    });
    expect(submissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quizId: quiz.id,
          userId: 7,
          clientAttemptId: '11111111-1111-4111-8111-111111111111',
          results: { create: [expect.objectContaining({ questionId: 240 })] },
        }),
      }),
    );
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 7,
          type: 'WRITING_PRACTICE_COMPLETED',
          sourceType: 'WRITING_SUBMISSION',
          sourceId: '501',
        }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'quiz.submitted',
      expect.objectContaining({ quizId: quiz.id, submissionId: 501 }),
    );
  });

  it('uses the canonical quiz prompt and rejects provider failure without fake completion', async () => {
    ai.evaluateWritingPart2.mockRejectedValueOnce(new Error('provider down'));
    const service = new WritingService(
      prisma as any,
      ai as any,
      undefined,
      events as any,
    );

    await expect(
      service.submitWritingPart2(
        quiz.id,
        7,
        'My response',
        undefined,
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toThrow('Dịch vụ chấm bài hiện không khả dụng');
    expect(ai.evaluateWritingPart2).toHaveBeenCalledWith(
      'Canonical prompt',
      'My response',
    );
    expect(submissionCreate).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('returns the existing assessment for the same client attempt', async () => {
    submissionFindUnique.mockResolvedValueOnce({
      id: 700,
      score: 4,
      aiFeedback: JSON.stringify({
        score: 4,
        maxScore: 4,
        feedback: 'Đã lưu',
        suggestions: [],
      }),
      results: [{ questionId: 240 }],
    });
    const service = new WritingService(
      prisma as any,
      ai as any,
      undefined,
      events as any,
    );

    const result = await service.submitWritingPart2(
      quiz.id,
      7,
      'Retried transport',
      undefined,
      '33333333-3333-4333-8333-333333333333',
    );

    expect(result).toMatchObject({ submissionId: 700, score: 4 });
    expect(ai.evaluateWritingPart2).not.toHaveBeenCalled();
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it('enforces the existing server-side access boundary', async () => {
    const access = {
      assertAccess: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('locked')),
    };
    const service = new WritingService(
      prisma as any,
      ai as any,
      access as any,
      events as any,
    );

    await expect(
      service.submitWritingPart2(
        quiz.id,
        7,
        'My response',
        undefined,
        '44444444-4444-4444-8444-444444444444',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(ai.evaluateWritingPart2).not.toHaveBeenCalled();
  });

  it('persists Part 3 with the five-point canonical task contract', async () => {
    prisma.quiz.findUnique.mockResolvedValueOnce({
      ...quiz,
      practiceTopic: { category: TopicCategory.WRITING_PART2 },
      questions: [
        { id: 241, content: { prompt: 'Essay prompt', taskType: 'OPINION' } },
      ],
    });
    ai.evaluateWritingPart3.mockResolvedValueOnce({
      score: 4,
      feedback: 'Mạch lạc',
      suggestions: ['Bổ sung ví dụ'],
    });
    submissionCreate.mockResolvedValueOnce({ id: 701 });
    const service = new WritingService(
      prisma as any,
      ai as any,
      undefined,
      events as any,
    );

    const result = await service.submitWritingPart3(
      quiz.id,
      7,
      'My essay',
      undefined,
      '55555555-5555-4555-8555-555555555555',
    );

    expect(result).toMatchObject({ submissionId: 701, maxScore: 5, score: 4 });
    expect(submissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          results: { create: [expect.objectContaining({ questionId: 241 })] },
        }),
      }),
    );
  });
});
