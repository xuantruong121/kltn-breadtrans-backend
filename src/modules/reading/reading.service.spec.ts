import { Test, TestingModule } from '@nestjs/testing';
import {
  countReadingSentenceUnits,
  countReadingSentences,
  isReadingSubmissionComplete,
  resolveReadingTopicLevel,
  ReadingService,
} from './reading.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';

describe('ReadingService', () => {
  let service: ReadingService;
  let access: { resolveMany: jest.Mock; assertAccess: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadingService,
        {
          provide: PrismaService,
          useValue: {
            practiceTopic: { findMany: jest.fn(), findUnique: jest.fn() },
            quiz: { findMany: jest.fn(), findUnique: jest.fn() },
            result: { findMany: jest.fn() },
            submission: { findMany: jest.fn() },
            userStats: { findUnique: jest.fn() },
          },
        },
        {
          provide: QuizContentAccessService,
          useValue: {
            resolveMany: jest.fn().mockResolvedValue(new Map()),
            assertAccess: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ReadingService>(ReadingService);
    access = service['quizContentAccess'] as unknown as typeof access;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('counts sentence units deterministically and safely', () => {
    expect(countReadingSentenceUnits('One. Two!')).toBe(2);
    expect(countReadingSentenceUnits('  One   sentence ')).toBe(1);
    expect(countReadingSentenceUnits(null)).toBe(0);
  });

  it('prefers canonical sentence content and deduplicates it', () => {
    expect(
      countReadingSentences(
        [
          { en: 'First sentence.' },
          { en: 'Second sentence!' },
          { en: 'First sentence.' },
        ],
        [],
      ),
    ).toBe(2);
  });

  it('derives unique passage sentence metrics when metadata is not a collection', () => {
    expect(
      countReadingSentences({ title: 'Reading metadata' }, [
        { passage: 'A passage. It has two sentences.' },
        { passage: 'A passage. It has two sentences.' },
        { passage: 'Another passage?' },
      ]),
    ).toBe(3);
  });

  it('requires an exact current question/result set for completion', () => {
    expect(isReadingSubmissionComplete([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isReadingSubmissionComplete([1, 2, 3], [1, 2, 999])).toBe(false);
    expect(isReadingSubmissionComplete([1, 2, 3], [1, 2, 3, 3])).toBe(false);
    expect(isReadingSubmissionComplete([1, 2, 3], [1, 2])).toBe(false);
  });

  it('counts sentences only for a fully completed Reading quiz', async () => {
    const prisma = service['prisma'] as unknown as {
      quiz: { findMany: jest.Mock };
      submission: { findMany: jest.Mock };
    };
    prisma.quiz.findMany.mockResolvedValue([
      {
        id: 24,
        title: 'Travel',
        bilingualContent: { title: 'metadata' },
        questions: [
          { id: 1, content: { passage: 'One. Two.' } },
          { id: 2, content: { passage: 'One. Two.' } },
        ],
        _count: { questions: 2 },
      },
    ]);
    prisma.submission.findMany.mockResolvedValue([
      {
        quizId: 24,
        results: [
          { questionId: 1, isCorrect: true },
          { questionId: 2, isCorrect: false },
        ],
      },
    ]);

    await expect(service.getBilingualProgress(7)).resolves.toMatchObject({
      completedArticles: 1,
      sentencesRead: 2,
      questionsAnswered: 2,
      completedArticlesList: [
        { title: 'Travel', sentencesCount: 2, questionsCount: 2 },
      ],
    });
  });

  it('returns safe topic quiz metadata without a premium passage body', async () => {
    const prisma = service['prisma'] as unknown as {
      practiceTopic: { findMany: jest.Mock };
    };
    prisma.practiceTopic.findMany.mockResolvedValue([
      {
        id: 4,
        name: 'Reading A1',
        vietnameseName: 'Đọc A1',
        iconUrl: null,
        category: 'BILINGUAL_LEVEL',
        quizzes: [
          {
            id: 24,
            title: 'Museum',
            description: 'Premium reading',
            type: 'BILINGUAL_READING',
            courseId: null,
            isPremiumContent: true,
            timeLimit: 10,
            _count: { questions: 5 },
            questions: [{ id: 1 }],
          },
        ],
      },
    ]);
    access.resolveMany.mockResolvedValue(
      new Map([[24, { isPremiumContent: true, isLocked: true }]]),
    );

    const result = await service.getTopicsByCategory(
      'BILINGUAL_LEVEL',
      undefined,
    );

    expect(result[0].quizzes).toEqual([
      expect.objectContaining({
        id: 24,
        isPremiumContent: true,
        isLocked: true,
        questionCount: 5,
      }),
    ]);
    expect(result[0].quizzes[0]).not.toHaveProperty('bilingualContent');
  });

  it('resolves authoritative CEFR levels for reading topics', () => {
    expect(resolveReadingTopicLevel('Reading A1–A2')).toBe('BEGINNER');
    expect(resolveReadingTopicLevel('Reading A1-A2')).toBe('BEGINNER');
    expect(resolveReadingTopicLevel('Reading B1–B2')).toBe('INTERMEDIATE');
    expect(resolveReadingTopicLevel('Reading B1-B2')).toBe('INTERMEDIATE');
    expect(resolveReadingTopicLevel('Reading C1')).toBe('ADVANCED');
    expect(resolveReadingTopicLevel('Reading C2')).toBe('ADVANCED');
    expect(resolveReadingTopicLevel('General Reading')).toBe('BEGINNER');
  });

  it('derives Reading subskills, mistakes, trend and a deterministic recommendation from completed submissions', async () => {
    const prisma = service['prisma'] as unknown as {
      submission: { findMany: jest.Mock };
      quiz: { findMany: jest.Mock };
      userStats: { findUnique: jest.Mock };
    };
    const questions = [
      {
        id: 101,
        type: 'MULTIPLE_CHOICE',
        order: 1,
        content: {
          text: 'What is the main detail?',
          questionType: 'DETAIL',
          options: ['A', 'B'],
          correctIndex: 0,
          explanation: 'The passage states A.',
        },
      },
      {
        id: 102,
        type: 'MULTIPLE_CHOICE',
        order: 2,
        content: {
          text: 'What can be inferred?',
          questionType: 'INFERENCE',
          options: ['A', 'B'],
          correctIndex: 1,
        },
      },
    ];
    prisma.userStats.findUnique.mockResolvedValue({ streakCount: 2 });
    prisma.submission.findMany.mockResolvedValue(
      [1, 2, 3].map((id) => ({
        id,
        quizId: 24,
        submittedAt: new Date(`2026-10-0${id}T10:00:00.000Z`),
        quiz: {
          id: 24,
          title: 'Reading practice',
          isPremiumContent: false,
          publicationStatus: 'PUBLISHED',
          questions,
        },
        results: [
          { questionId: 101, answer: 'B', isCorrect: false },
          { questionId: 102, answer: 'B', isCorrect: true },
        ],
      })),
    );
    prisma.quiz.findMany.mockResolvedValue([
      {
        id: 30,
        title: 'Inference and detail review',
        type: 'BILINGUAL_READING',
        isPremiumContent: false,
        courseId: null,
        questions: [{ content: { questionType: 'DETAIL' } }],
      },
    ]);
    access.resolveMany.mockResolvedValue(
      new Map([[30, { isPremiumContent: false, isLocked: false }]]),
    );

    const result = await service.getTracking(7);

    expect(result.progress).toMatchObject({
      completedExercises: 1,
      completedAttempts: 3,
      accuracy: 50,
      currentStreak: 2,
    });
    expect(
      result.subskills.find((item) => item.key === 'DETAIL'),
    ).toMatchObject({
      attempted: 3,
      correct: 0,
      accuracy: 0,
      status: 'NEEDS_IMPROVEMENT',
    });
    expect(result.mistakes).toMatchObject({ total: 3 });
    expect(result.mistakes.items[0]).toMatchObject({
      subskill: 'DETAIL',
      correctAnswer: 'A',
      answerAvailable: true,
    });
    expect(result.recommendation).toMatchObject({
      subskill: 'DETAIL',
      quizId: 30,
      isLocked: false,
    });
  });

  it('returns an honest zero-state without fake weakness or division by zero', async () => {
    const prisma = service['prisma'] as unknown as {
      submission: { findMany: jest.Mock };
      userStats: { findUnique: jest.Mock };
    };
    prisma.submission.findMany.mockResolvedValue([]);
    prisma.userStats.findUnique.mockResolvedValue(null);

    const result = await service.getTracking(999);

    expect(result.progress).toMatchObject({
      completedExercises: 0,
      completedAttempts: 0,
      accuracy: 0,
      recentAverage: 0,
      lastPracticedAt: null,
    });
    expect(result.recommendation).toBeNull();
    expect(
      result.subskills.every((item) => item.status === 'INSUFFICIENT_DATA'),
    ).toBe(true);
    expect(result.mistakes.total).toBe(0);
  });
});
