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
});
