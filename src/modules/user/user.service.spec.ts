import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
});
