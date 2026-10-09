import { BadRequestException } from '@nestjs/common';
import { DiagnosticService } from './diagnostic.service';

describe('DiagnosticService', () => {
  const questions = [
    {
      id: 1,
      assessmentId: 1,
      skill: 'Reading',
      question: 'A',
      options: ['a', 'b'],
      correctIndex: 0,
      explanation: 'A',
      order: 1,
    },
    {
      id: 2,
      assessmentId: 1,
      skill: 'Reading',
      question: 'B',
      options: ['a', 'b'],
      correctIndex: 1,
      explanation: 'B',
      order: 2,
    },
    {
      id: 3,
      assessmentId: 1,
      skill: 'Reading',
      question: 'C',
      options: ['a', 'b'],
      correctIndex: 0,
      explanation: 'C',
      order: 3,
    },
  ];
  const assessment = {
    id: 1,
    title: 'Entry',
    description: 'General English',
    isActive: true,
    questions,
  };
  let prisma: any;
  let service: DiagnosticService;

  beforeEach(() => {
    prisma = {
      diagnosticAssessment: {
        findFirst: jest.fn().mockResolvedValue(assessment),
      },
      diagnosticAttempt: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
      course: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            title: 'Foundations',
            description: 'Grammar',
            level: 'BEGINNER',
            status: 'PUBLISHED',
            _count: { lessons: 3 },
            lessons: [
              {
                id: 1,
                title: 'Listening',
                description: null,
                order: 1,
                materials: [],
              },
            ],
            quizzes: [
              {
                id: 1,
                title: 'Listening',
                description: null,
                type: 'LISTENING_PRACTICE',
                publicationStatus: 'PUBLISHED',
                isPremiumContent: false,
                _count: { questions: 1 },
              },
              {
                id: 2,
                title: 'Reading',
                description: null,
                type: 'BILINGUAL_READING',
                publicationStatus: 'PUBLISHED',
                isPremiumContent: false,
                _count: { questions: 1 },
              },
              {
                id: 3,
                title: 'Writing',
                description: null,
                type: 'WRITING_EMAIL',
                publicationStatus: 'PUBLISHED',
                isPremiumContent: false,
                _count: { questions: 1 },
              },
              {
                id: 4,
                title: 'Speaking',
                description: null,
                type: 'SPEAKING',
                publicationStatus: 'PUBLISHED',
                isPremiumContent: false,
                _count: { questions: 1 },
              },
            ],
          },
        ]),
      },
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback({
          diagnosticAttempt: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({
              id: 4,
              answers: { '1': 0, '2': 1, '3': 0 },
              correctCount: 3,
              totalCount: 3,
              percentage: 100,
              level: 'Intermediate',
              submittedAt: new Date(),
            }),
          },
          learningActivity: { create: jest.fn() },
          userStats: { upsert: jest.fn() },
        }),
      ),
    };
    service = new DiagnosticService(prisma);
  });

  it('rejects missing, unknown and out-of-range answers before transaction', async () => {
    await expect(
      service.submitAssessment(1, 1, { '1': 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submitAssessment(1, 1, { '1': 0, '2': 1, '3': 0, '999': 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submitAssessment(1, 1, { '1': 8, '2': 1, '3': 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('scores against the server question set and excludes incomplete course roadmaps', async () => {
    const result = await service.submitAssessment(
      7,
      1,
      { '1': 0, '2': 1, '3': 0 },
      'token-1',
    );
    expect(result).toMatchObject({
      attemptId: 4,
      correctCount: 3,
      totalCount: 3,
      percentage: 100,
      level: 'Intermediate',
    });
    expect(result.questionsResult).toHaveLength(3);
    expect(result.skillProfiles[0]).toMatchObject({
      skill: 'Reading',
      correctCount: 3,
      totalCount: 3,
      percentage: 100,
    });
    expect(result.recommendations).toEqual([]);
  });

  it('does not expose answer keys in the pre-submit assessment payload', async () => {
    const result = await service.getCurrentAssessment(7);
    expect(result.questions[0]).not.toHaveProperty('correctIndex');
    expect(result.questions[0]).not.toHaveProperty('explanation');
  });

  it('reuses a submission with the same client token without creating another attempt', async () => {
    const existing = {
      id: 9,
      answers: { '1': 0, '2': 1, '3': 0, __submissionToken: 'same-token' },
      correctCount: 3,
      totalCount: 3,
      percentage: 100,
      level: 'Intermediate',
      submittedAt: new Date(),
    };
    (prisma.$transaction as jest.Mock).mockImplementationOnce(
      (callback: (tx: any) => unknown) =>
        callback({
          diagnosticAttempt: {
            findFirst: jest.fn().mockResolvedValue(existing),
            create: jest.fn(),
          },
          learningActivity: { create: jest.fn() },
          userStats: { upsert: jest.fn() },
        }),
    );
    const result = await service.submitAssessment(
      7,
      1,
      { '1': 0, '2': 1, '3': 0 },
      'same-token',
    );
    expect(result.attemptId).toBe(9);
    expect(prisma.$transaction.mock.calls[0][0]).toBeDefined();
  });
});
