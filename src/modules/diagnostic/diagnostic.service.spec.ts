import { BadRequestException } from '@nestjs/common';
import { getLearnerQuestionPermutation } from './diagnostic.logic';
import { DiagnosticService } from './diagnostic.service';

/**
 * The displayed index a learner clicks for an AUTHORED option. Answers are
 * submitted as displayed indexes, so a test that means "the learner chose
 * option N" must translate through the server's own display permutation.
 */
const shown = (
  userId: number,
  assessmentId: number,
  questionId: number,
  authoredIndex: number,
  optionCount: number,
) =>
  getLearnerQuestionPermutation(
    userId,
    assessmentId,
    questionId,
    optionCount,
  ).indexOf(authoredIndex);

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
    // Persisted scoring identity. Production resolves the scorer from this
    // field, so every assessment fixture must state it.
    scoringVersion: 'OBJECTIVE_POOLED_V1',
    blueprintVersion: 'V1_LEGACY_20_ITEM',
    contentVersion: 1,
    status: 'ACTIVE',
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
        // The learner's own in-progress attempt on this assessment.
        findUnique: jest.fn().mockResolvedValue({
          id: 4,
          userId: 7,
          assessmentId: 1,
          status: 'IN_PROGRESS',
          answers: {},
        }),
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
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback({
          $executeRaw: jest.fn().mockResolvedValue(0),
          diagnosticAttempt: {
            findFirst: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
            findUnique: jest
              .fn()
              .mockResolvedValue({ id: 4, status: 'IN_PROGRESS' }),
            // Echo what was written, as the database would.
            update: jest.fn((args: { data: Record<string, unknown> }) =>
              Promise.resolve({
                id: 4,
                userId: 7,
                assessmentId: 1,
                submittedAt: new Date(),
                ...args.data,
              }),
            ),
          },
          learningActivity: { create: jest.fn() },
          userStats: {
            upsert: jest.fn().mockResolvedValue({ totalBanhRan: 50 }),
          },
          banhTransaction: { create: jest.fn() },
        }),
      ),
    };
    const gamificationService = {
      awardBanh: jest
        .fn()
        .mockResolvedValue({ granted: 50, newBalance: 50, isCapped: true }),
    } as any;
    service = new DiagnosticService(prisma, gamificationService);
  });

  it('rejects missing, unknown and out-of-range answers before transaction', async () => {
    // Learner 7 on their own attempt 4, so each rejection below is caused by
    // the answers themselves rather than by an ownership failure.
    await expect(
      service.submitAssessment(7, 1, { '1': 0 }, undefined, 4),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submitAssessment(
        7,
        1,
        { '1': 0, '2': 1, '3': 0, '999': 0 },
        undefined,
        4,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submitAssessment(7, 1, { '1': 8, '2': 1, '3': 0 }, undefined, 4),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('scores against the server question set and excludes incomplete course roadmaps', async () => {
    const result = await service.submitAssessment(
      7,
      1,
      {
        '1': shown(7, 1, 1, 0, 2),
        '2': shown(7, 1, 2, 1, 2),
        '3': shown(7, 1, 3, 0, 2),
      },
      'token-1',
      4,
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
      userId: 7,
      assessmentId: 1,
      answers: { '1': 0, '2': 1, '3': 0, __submissionToken: 'same-token' },
      correctCount: 3,
      totalCount: 3,
      percentage: 100,
      level: 'Intermediate',
      submittedAt: new Date(),
    };
    const executeRaw = jest.fn().mockResolvedValue(0);
    (prisma.$transaction as jest.Mock).mockImplementationOnce(
      (callback: (tx: any) => unknown) =>
        callback({
          $executeRaw: executeRaw,
          diagnosticAttempt: {
            findFirst: jest.fn().mockResolvedValue(existing),
            count: jest.fn().mockResolvedValue(1),
            create: jest.fn(),
          },
          learningActivity: { create: jest.fn() },
          userStats: {
            upsert: jest.fn().mockResolvedValue({ totalBanhRan: 50 }),
          },
          banhTransaction: { create: jest.fn() },
        }),
    );
    const result = await service.submitAssessment(
      7,
      1,
      { '1': 0, '2': 1, '3': 0 },
      'same-token',
      4,
    );
    expect(result.attemptId).toBe(9);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toBeDefined();
  });

  it('scores the v2 objective denominator separately from productive tasks', async () => {
    const v2Questions = [
      {
        id: 101,
        assessmentId: 2,
        skill: 'Grammar',
        question: 'A',
        options: {
          values: ['a', 'b'],
          section: 'LANGUAGE_USE',
          intendedLevel: 'A1',
          stableKey: 'a',
          construct: 'grammar',
          questionType: 'MCQ',
        },
        correctIndex: 1,
        explanation: 'B',
        order: 1,
      },
      {
        id: 102,
        assessmentId: 2,
        skill: 'Reading',
        question: 'B',
        options: {
          values: ['a', 'b'],
          section: 'READING',
          intendedLevel: 'A1',
          stableKey: 'b',
          construct: 'detail',
          questionType: 'MCQ',
          passageText: 'A short notice.',
        },
        correctIndex: 0,
        explanation: 'A',
        order: 2,
      },
      {
        id: 103,
        assessmentId: 2,
        skill: 'Speaking',
        question: 'C',
        options: {
          values: [],
          section: 'SPEAKING',
          intendedLevel: 'A2',
          stableKey: 'c',
          construct: 'fluency',
          questionType: 'OPEN_TEXT',
        },
        correctIndex: -1,
        explanation: 'Supplementary',
        order: 3,
      },
    ];

    prisma.diagnosticAssessment.findFirst.mockResolvedValueOnce({
      ...assessment,
      id: 2,
      title: 'Entry Diagnostic v2',
      scoringVersion: 'OBJECTIVE_POOLED_V1',
      questions: v2Questions,
    });
    prisma.diagnosticAttempt.findUnique = jest.fn().mockResolvedValue({
      id: 10,
      userId: 7,
      assessmentId: 2,
      status: 'IN_PROGRESS',
      speakingResponses: [{ questionId: 103, status: 'SKIPPED', score: null }],
    });
    prisma.diagnosticSpeakingResponse = {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { questionId: 103, status: 'SKIPPED', score: null },
        ]),
      updateMany: jest.fn(),
    };

    prisma.$transaction.mockImplementationOnce(
      (callback: (tx: any) => unknown) =>
        callback({
          $executeRaw: jest.fn().mockResolvedValue(0),
          diagnosticAttempt: {
            findFirst: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
            findUnique: jest
              .fn()
              .mockResolvedValue({ id: 10, status: 'IN_PROGRESS' }),
            update: jest.fn((args: { data: Record<string, unknown> }) =>
              Promise.resolve({
                id: 10,
                userId: 7,
                assessmentId: 2,
                submittedAt: new Date(),
                ...args.data,
              }),
            ),
            create: jest.fn().mockResolvedValue({
              id: 10,
              answers: { '101': 1, '102': 1, '103': 'spoken answer' },
              correctCount: 1,
              totalCount: 2,
              percentage: 50,
              level: 'A1',
              submittedAt: new Date(),
            }),
          },
          learningActivity: { create: jest.fn() },
          userStats: {
            upsert: jest.fn().mockResolvedValue({ totalBanhRan: 50 }),
          },
          banhTransaction: { create: jest.fn() },
        }),
    );
    const result = await service.submitAssessment(
      7,
      2,
      // 101 answered correctly (authored option 1), 102 wrongly (authored 1,
      // key 0). A client-declared originalIndex is no longer accepted.
      {
        '101': shown(7, 2, 101, 1, 2),
        '102': shown(7, 2, 102, 1, 2),
        '103': 'SKIPPED',
      },
      'token-v2',
      10,
    );
    expect(result.totalCount).toBe(2);
    expect(result.objectiveTotalCount).toBe(2);
    expect(result.productiveTaskCount).toBe(1);
    expect(result.productiveUnavailable).toBe(true);
    expect(result.correctCount).toBe(1);
    expect(
      result.questionsResult.find((item) => item.questionId === 103)?.isCorrect,
    ).toBeNull();
  });
});
