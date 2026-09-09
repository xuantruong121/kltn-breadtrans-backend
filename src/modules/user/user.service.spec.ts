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
  },
  toeicAttempt: {
    count: jest.fn(),
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

      await expect(service.getUserStats(7)).resolves.toMatchObject({
        streakCount: 4,
        totalBanhRan: 125,
        totalPoints: 420,
        weeklyExp: 120,
        tier: 'Bạc',
        masteredVocabCount: 18,
        totalQuizzesDone: 5,
      });
      expect(prisma.toeicAttempt.count).toHaveBeenCalledWith({
        where: { userId: 7, submittedAt: { not: null } },
      });
    });
  });
});
