import { Test, TestingModule } from '@nestjs/testing';
import { QuizService } from './quiz.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SpeakingService } from '../speaking/speaking.service';

const mockPrismaService = {
  quiz: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  submission: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  question: {
    findUnique: jest.fn(),
  },
};

const mockAiService = {
  generateFeedback: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockSpeakingService = {
  generateTts: jest.fn(),
};

describe('QuizService', () => {
  let service: QuizService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AiService, useValue: mockAiService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: SpeakingService, useValue: mockSpeakingService },
      ],
    }).compile();

    service = module.get<QuizService>(QuizService);
    prisma = module.get<PrismaService>(PrismaService);
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

    it('blocks guests and removes listening answers and transcripts for students', async () => {
      const mockQuiz = {
        id: 9,
        type: 'LISTENING_PRACTICE',
        questions: [
          {
            id: 90,
            content: {
              correct: 'A',
              correctAnswer: 'A',
              correctIndex: 0,
              explanation: 'Because A is correct.',
              audioText: 'Hidden transcript',
              options: ['A', 'B'],
            },
          },
        ],
      };
      mockPrismaService.quiz.findUnique.mockResolvedValue(mockQuiz);

      await expect(service.getQuizById(9)).rejects.toThrow(
        UnauthorizedException,
      );

      const result = await service.getQuizById(9, false, 7);
      expect(result.questions[0].content).toEqual({ options: ['A', 'B'] });
    });
  });

  describe('listening practice checks', () => {
    it('grades on the server without creating a submission', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 91,
        quizId: 9,
        type: 'MULTIPLE_CHOICE',
        quiz: { id: 9, type: 'LISTENING_PRACTICE' },
        content: {
          options: ['Monday', 'Tuesday'],
          correctIndex: 1,
          explanation: 'The speaker says Tuesday.',
        },
      });

      await expect(
        service.checkPracticeQuestion(9, 91, { answer: 'Tuesday' }),
      ).resolves.toMatchObject({
        isCorrect: true,
        correctAnswer: 'Tuesday',
        explanation: 'The speaker says Tuesday.',
      });
      expect(mockPrismaService.submission.create).not.toHaveBeenCalled();
    });

    it('returns structured bilingual explanation object when present', async () => {
      const structuredExplanation = {
        vi: 'Người nói cho biết cửa hàng mở cửa lúc 9 giờ.',
        evidence: 'The shop opens at nine o’clock.',
        keyPhrase: 'opens at nine o’clock',
        vocabularyNote: 'open at = mở cửa vào lúc',
      };

      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 92,
        quizId: 9,
        type: 'MULTIPLE_CHOICE',
        quiz: { id: 9, type: 'LISTENING_PRACTICE' },
        content: {
          options: ['At 8:00', 'At 9:00'],
          correctIndex: 1,
          explanation: structuredExplanation,
        },
      });

      const res = await service.checkPracticeQuestion(9, 92, {
        answer: 'At 9:00',
      });
      expect(res.isCorrect).toBe(true);
      expect(res.explanation).toEqual(structuredExplanation);
    });
  });

  describe('getToeicPapers', () => {
    it('only queries TOEIC papers with a supported examFormat', async () => {
      mockPrismaService.quiz.findMany.mockResolvedValue([]);
      mockPrismaService.submission.findMany.mockResolvedValue([]);

      await service.getToeicPapers(7);

      expect(prisma.quiz.findMany).toHaveBeenCalledWith({
        where: {
          type: 'TOEIC',
          OR: [
            {
              bilingualContent: {
                path: ['examFormat'],
                equals: 'TWO_SKILL',
              },
            },
            {
              bilingualContent: {
                path: ['examFormat'],
                equals: 'FOUR_SKILL',
              },
            },
          ],
        },
        include: { _count: { select: { questions: true } } },
        orderBy: { id: 'asc' },
      });
    });
  });
});
