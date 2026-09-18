import { Test, TestingModule } from '@nestjs/testing';
import { normalizeListeningAnswer, QuizService } from './quiz.service';
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
    findFirst: jest.fn(),
  },
  listeningPracticeAttempt: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
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

    it('checks dictation on the server while tolerating punctuation and spacing', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 93,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        content: {
          correctAnswer: "Let's meet at 8:30.",
          translation: 'Hãy gặp nhau lúc 8:30.',
        },
      });

      await expect(
        service.checkPracticeQuestion(23, 93, {
          answer: ' lets meet at 8:30 ',
        }),
      ).resolves.toMatchObject({
        isCorrect: true,
        correctAnswer: "Let's meet at 8:30.",
      });
      expect(mockPrismaService.submission.create).not.toHaveBeenCalled();
    });

    it('returns word-level accuracy for an incomplete dictation answer', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 94,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        content: {
          correctAnswer: 'The meeting starts at nine tomorrow.',
        },
      });

      await expect(
        service.checkPracticeQuestion(23, 94, {
          answer: 'The meeting starts at nine.',
        }),
      ).resolves.toMatchObject({
        isCorrect: false,
        evaluationMode: 'STANDARD',
        wordAccuracy: 83,
      });
    });

    it('keeps strict dictation punctuation and casing meaningful', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 95,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        content: {
          correctAnswer: 'Hello, team.',
          dictationMode: 'STRICT',
        },
      });

      await expect(
        service.checkPracticeQuestion(23, 95, { answer: 'hello team.' }),
      ).resolves.toMatchObject({
        isCorrect: false,
        evaluationMode: 'STRICT',
        wordAccuracy: 50,
      });
    });

    it('normalizes curly apostrophes as optional dictation punctuation', () => {
      expect(normalizeListeningAnswer('  Don’t   worry!  ')).toBe('dont worry');
    });
  });

  describe('listening practice attempts', () => {
    it('reuses an in-progress server session', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 23,
        type: 'LISTENING_PRACTICE',
      });
      mockPrismaService.listeningPracticeAttempt.findFirst.mockResolvedValue({
        id: 7,
        quizId: 23,
        currentQuestionId: 101,
        answers: { '101': 'draft' },
        questionStates: {},
        status: 'IN_PROGRESS',
        startedAt: new Date('2026-09-18T08:00:00.000Z'),
        updatedAt: new Date('2026-09-18T08:01:00.000Z'),
      });

      await expect(
        service.getOrCreateListeningAttempt(12, 23),
      ).resolves.toMatchObject({
        id: 7,
        currentQuestionId: 101,
        answers: { '101': 'draft' },
      });
      expect(
        mockPrismaService.listeningPracticeAttempt.create,
      ).not.toHaveBeenCalled();
    });

    it('rejects checkpoint questions from another quiz', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 23,
        type: 'LISTENING_PRACTICE',
      });
      mockPrismaService.listeningPracticeAttempt.findFirst.mockResolvedValue({
        id: 7,
        quizId: 23,
        userId: 12,
        status: 'IN_PROGRESS',
      });
      mockPrismaService.question.findFirst.mockResolvedValue(null);

      await expect(
        service.saveListeningAttempt(12, 23, 7, { currentQuestionId: 999 }),
      ).rejects.toThrow('Câu hỏi không thuộc bài luyện này');
    });
  });

  describe('getToeicPapers', () => {
    it('only queries TOEIC papers with a supported examFormat', async () => {
      mockPrismaService.quiz.findMany.mockResolvedValue([]);
      mockPrismaService.submission.findMany.mockResolvedValue([]);

      await service.getToeicPapers(7);

      expect(prisma.quiz.findMany).toHaveBeenCalledWith({
        where: {
          type: { in: ['TOEIC', 'TOEIC_FOUR_SKILL'] },
          OR: [
            {
              bilingualContent: {
                path: ['examFormat'],
                equals: 'TOEIC_LR',
              },
            },
            {
              bilingualContent: {
                path: ['examFormat'],
                equals: 'TOEIC_SW',
              },
            },
            {
              bilingualContent: {
                path: ['examFormat'],
                equals: 'TOEIC_4_SKILLS',
              },
            },
            {
              bilingualContent: {
                path: ['examFormat'],
                equals: 'TWO_SKILL',
              },
            },
            {
              bilingualContent: {
                path: ['examFormat'],
                equals: 'SPEAKING_WRITING',
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
