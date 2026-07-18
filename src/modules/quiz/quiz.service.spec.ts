import { Test, TestingModule } from '@nestjs/testing';
import { QuizService } from './quiz.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

const mockPrismaService = {
  quiz: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  submission: {
    create: jest.fn(),
  },
};

const mockAiService = {
  generateFeedback: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('QuizService', () => {
  let service: QuizService;
  let prisma: PrismaService;
  let ai: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AiService, useValue: mockAiService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<QuizService>(QuizService);
    prisma = module.get<PrismaService>(PrismaService);
    ai = module.get<AiService>(AiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getQuizById', () => {
    it('should return a quiz if it exists', async () => {
      const mockQuiz = { id: 1, title: 'Test Quiz', questions: [] };
      mockPrismaService.quiz.findUnique.mockResolvedValue(mockQuiz);

      const result = await service.getQuizById(1);
      
      expect(prisma.quiz.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { questions: { orderBy: { order: 'asc' } } },
      });
      expect(result).toEqual(mockQuiz);
    });

    it('should throw NotFoundException if quiz does not exist', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue(null);

      await expect(service.getQuizById(999)).rejects.toThrow(NotFoundException);
    });
  });
});
