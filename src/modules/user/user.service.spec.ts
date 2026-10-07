import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReadingService } from '../reading/reading.service';

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  profile: {
    upsert: jest.fn(),
  },
  userStats: {
    findUnique: jest.fn(),
  },
  leaderboard: {
    findUnique: jest.fn(),
  },
  userPet: {
    findUnique: jest.fn(),
  },
  userVocabWordProgress: {
    count: jest.fn(),
  },
  submission: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  quiz: {
    findMany: jest.fn(),
  },
  speakingExercise: {
    count: jest.fn(),
  },
  speakingSubmission: {
    findMany: jest.fn(),
  },
  toeicAttempt: {
    count: jest.fn(),
  },
  diagnosticAttempt: {
    findFirst: jest.fn(),
  },
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockReadingService = {
  getTracking: jest.fn(),
};

describe('UserService', () => {
  let service: UserService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: ReadingService,
          useValue: mockReadingService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserProfile', () => {
    it('should return a user without password if found', async () => {
      const mockUser = {
        id: 1,
        email: 'test@test.com',
        password: 'hashedpassword',
        profile: null,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserProfile(1);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: {
          profile: true,
          stats: true,
          leaderboard: true,
          pet: true,
          billing: true,
        },
      });
      expect(result).toHaveProperty('id', 1);
      expect(result).not.toHaveProperty('password');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserProfile(999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUserStats', () => {
    it('counts only submitted TOEIC attempts and maps aggregate learning data', async () => {
      mockPrismaService.userStats.findUnique.mockResolvedValue({
        streakCount: 4,
        streakFreezes: 1,
        totalBanhRan: 125,
        quizAccuracy: 82,
        speakingAccuracy: 76,
      });
      mockPrismaService.leaderboard.findUnique.mockResolvedValue({
        totalPoints: 420,
        weeklyExp: 120,
        tier: 'Bạc',
      });
      mockPrismaService.userPet.findUnique.mockResolvedValue(null);
      mockPrismaService.userVocabWordProgress.count.mockResolvedValue(18);
      mockPrismaService.submission.count.mockResolvedValue(3);
      mockPrismaService.toeicAttempt.count.mockResolvedValue(2);
      mockPrismaService.diagnosticAttempt.findFirst.mockResolvedValue({
        id: 1,
        level: 'Foundation',
        percentage: 60,
        submittedAt: new Date('2026-09-09T00:00:00Z'),
      });

      await expect(service.getUserStats(7)).resolves.toMatchObject({
        streakCount: 4,
        totalBanhRan: 125,
        totalPoints: 420,
        weeklyExp: 120,
        tier: 'Bạc',
        masteredVocabCount: 18,
        totalQuizzesDone: 5,
        hasCompletedPlacementTest: true,
        latestDiagnostic: {
          level: 'Foundation',
          percentage: 60,
        },
      });
      expect(prisma.toeicAttempt.count).toHaveBeenCalledWith({
        where: { userId: 7, submittedAt: { not: null } },
      });
    });
  });

  describe('getUserSkillsSummary', () => {
    it('returns 0 completed and 0% for a new user with empty catalog or no completions', async () => {
      mockPrismaService.quiz.findMany
        .mockResolvedValueOnce([]) // listening quizzes
        .mockResolvedValueOnce([]) // reading quizzes
        .mockResolvedValueOnce([]); // writing quizzes
      mockPrismaService.submission.findMany
        .mockResolvedValueOnce([]) // listening submissions
        .mockResolvedValueOnce([]) // reading submissions
        .mockResolvedValueOnce([]); // writing submissions
      mockPrismaService.speakingExercise.count.mockResolvedValue(0);
      mockPrismaService.speakingSubmission.findMany.mockResolvedValue([]);

      const result = await service.getUserSkillsSummary(99);

      expect(result.overall).toEqual({
        totalItems: 0,
        completedItems: 0,
        progressPercent: 0,
      });
      expect(result.skills).toHaveLength(4);
      result.skills.forEach((s) => {
        expect(s.totalItems).toBe(0);
        expect(s.completedItems).toBe(0);
        expect(s.progressPercent).toBe(0);
      });
    });

    it('calculates aggregate math correctly across 4 skills and clamps progress to 100%', async () => {
      // Listening: 10 total, 5 completed (50%)
      // Reading: 10 total, 10 completed (100%)
      // Speaking: 10 total, 3 completed (30%)
      // Writing: 10 total, 2 completed (20%)
      // Total: 40, Completed: 20 => 50%
      mockPrismaService.quiz.findMany
        .mockResolvedValueOnce(
          Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
        ) // listening
        .mockResolvedValueOnce(
          Array.from({ length: 10 }, (_, i) => ({ id: i + 11 })),
        ) // reading
        .mockResolvedValueOnce(
          Array.from({ length: 10 }, (_, i) => ({ id: i + 21 })),
        ); // writing

      mockPrismaService.submission.findMany
        .mockResolvedValueOnce(
          Array.from({ length: 5 }, (_, i) => ({ quizId: i + 1 })),
        ) // listening completed
        .mockResolvedValueOnce(
          Array.from({ length: 10 }, (_, i) => ({ quizId: i + 11 })),
        ) // reading completed
        .mockResolvedValueOnce(
          Array.from({ length: 2 }, (_, i) => ({ quizId: i + 21 })),
        ); // writing completed

      mockPrismaService.speakingExercise.count.mockResolvedValue(10);
      mockPrismaService.speakingSubmission.findMany.mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({ exerciseId: i + 1 })),
      );

      const result = await service.getUserSkillsSummary(1);

      expect(result.overall).toEqual({
        totalItems: 40,
        completedItems: 20,
        progressPercent: 50,
      });

      const listening = result.skills.find((s) => s.skill === 'LISTENING');
      expect(listening?.progressPercent).toBe(50);
      expect(listening?.completedItems).toBe(5);
      expect(listening?.totalItems).toBe(10);

      const reading = result.skills.find((s) => s.skill === 'READING');
      expect(reading?.progressPercent).toBe(100);

      // Verify progress percent never exceeds 100
      expect(result.overall.progressPercent).toBeLessThanOrEqual(100);
      expect(result.overall.progressPercent).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSkillProgressSummary', () => {
    it('returns a safe zero state for all skills without history', async () => {
      mockPrismaService.submission.findMany.mockResolvedValue([]);
      mockPrismaService.speakingSubmission.findMany.mockResolvedValue([]);
      mockPrismaService.userStats.findUnique.mockResolvedValue({
        streakCount: 0,
      });
      mockReadingService.getTracking.mockResolvedValue({
        progress: {
          completedExercises: 0,
          completedAttempts: 0,
          accuracy: 0,
          recentAverage: 0,
          lastPracticedAt: null,
          currentStreak: 0,
        },
        subskills: [],
        recentTrend: {
          direction: 'INSUFFICIENT_DATA',
          delta: null,
          attempts: [],
        },
      });

      const result = await service.getSkillProgressSummary(21);

      expect(result.skills).toHaveLength(4);
      expect(
        result.skills.every((skill) => skill.status === 'INSUFFICIENT_DATA'),
      ).toBe(true);
      expect(
        result.skills.every((skill) => skill.normalizedScore === null),
      ).toBe(true);
      expect(result.overall.trend).toBe('INSUFFICIENT_DATA');
      expect(result.overall.normalizedScore).toBeNull();
    });

    it('normalizes speaking and mixed-scale writing scores without counting failed speaking jobs', async () => {
      mockPrismaService.submission.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            submittedAt: new Date('2026-10-01T00:00:00Z'),
            score: 4,
            aiFeedback: JSON.stringify({ maxScore: 4 }),
            quiz: {
              type: 'WRITING_EMAIL',
              questions: [{ content: { taskType: 'EMAIL' } }],
            },
            results: [{ score: 4 }],
          },
          {
            submittedAt: new Date('2026-10-02T00:00:00Z'),
            score: 5,
            aiFeedback: JSON.stringify({ maxScore: 5 }),
            quiz: {
              type: 'WRITING_EMAIL',
              questions: [{ content: { taskType: 'OPINION' } }],
            },
            results: [{ score: 5 }],
          },
          {
            submittedAt: new Date('2026-10-03T00:00:00Z'),
            score: 2,
            aiFeedback: JSON.stringify({ maxScore: 5 }),
            quiz: {
              type: 'WRITING_EMAIL',
              questions: [{ content: { taskType: 'OPINION' } }],
            },
            results: [{ score: 2 }],
          },
        ]);
      mockPrismaService.speakingSubmission.findMany.mockResolvedValue([
        {
          overallScore: 8.2,
          aiFeedback: { accuracyScore: 80, fluencyScore: 60 },
          submittedAt: new Date('2026-10-01T00:00:00Z'),
        },
        {
          overallScore: 9,
          aiFeedback: { accuracyScore: 90, fluencyScore: 70 },
          submittedAt: new Date('2026-10-02T00:00:00Z'),
        },
      ]);
      mockPrismaService.userStats.findUnique.mockResolvedValue({
        streakCount: 4,
      });
      mockReadingService.getTracking.mockResolvedValue({
        progress: { completedAttempts: 3, accuracy: 85 },
        subskills: [{ key: 'DETAIL', attempted: 3, accuracy: 85 }],
        recentTrend: {
          direction: 'IMPROVING',
          delta: 10,
          attempts: [
            { accuracy: 75, submittedAt: '2026-10-01T00:00:00.000Z' },
            { accuracy: 85, submittedAt: '2026-10-02T00:00:00.000Z' },
          ],
        },
      });

      const result = await service.getSkillProgressSummary(21);
      const speaking = result.skills.find(
        (skill) => skill.skill === 'SPEAKING',
      );
      const writing = result.skills.find((skill) => skill.skill === 'WRITING');

      expect(speaking?.normalizedScore).toBe(86);
      expect(speaking?.completedAttempts).toBe(2);
      expect(writing?.normalizedScore).toBe(80);
      expect(writing?.completedAttempts).toBe(3);
      expect(result.overall.currentStreak).toBe(4);
    });

    it('derives Listening completion, deterministic score and dimensions from persisted results', async () => {
      const question = {
        id: 1,
        type: 'MULTIPLE_CHOICE',
        content: { category: 'DETAIL' },
      };
      const makeAttempt = (score: boolean, date: string) => ({
        submittedAt: new Date(date),
        quiz: { questions: [question] },
        results: [{ questionId: 1, isCorrect: score }],
      });
      mockPrismaService.submission.findMany
        .mockResolvedValueOnce([
          makeAttempt(true, '2026-10-01T00:00:00Z'),
          makeAttempt(false, '2026-10-02T00:00:00Z'),
          makeAttempt(true, '2026-10-03T00:00:00Z'),
        ])
        .mockResolvedValueOnce([]);
      mockPrismaService.speakingSubmission.findMany.mockResolvedValue([]);
      mockPrismaService.userStats.findUnique.mockResolvedValue({
        streakCount: 1,
      });
      mockReadingService.getTracking.mockResolvedValue({
        progress: { completedAttempts: 0, accuracy: 0 },
        subskills: [],
        recentTrend: {
          direction: 'INSUFFICIENT_DATA',
          delta: null,
          attempts: [],
        },
      });

      const result = await service.getSkillProgressSummary(21);
      const listening = result.skills.find(
        (skill) => skill.skill === 'LISTENING',
      );

      expect(listening?.completedAttempts).toBe(3);
      expect(listening?.normalizedScore).toBe(67);
      expect(listening?.trend).toBe('IMPROVING');
      expect(listening?.dimensions).toEqual([
        expect.objectContaining({
          key: 'DETAIL',
          sampleCount: 3,
          averageScore: 67,
        }),
      ]);
      expect(
        mockPrismaService.speakingSubmission.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 21, status: 'COMPLETED' } }),
      );
    });
  });
});
