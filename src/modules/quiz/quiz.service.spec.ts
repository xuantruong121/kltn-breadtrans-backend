import { Test, TestingModule } from '@nestjs/testing';
import {
  buildNaturalListeningAudioText,
  calculateProgressiveDictationFeedback,
  canonicalizeSubmittedDictation,
  getLexicalLetterCount,
  maskExpectedWord,
  normalizeDialogueSegments,
  normalizeListeningAnswer,
  QuizService,
  resolveReadingMicroSkill,
  validateReadingSubmission,
} from './quiz.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SpeakingService } from '../speaking/speaking.service';
import { UploadService } from '../upload/upload.service';
import { ListeningAudioAuthoringService } from './listening-audio-authoring.service';
import { QuizContentAccessService } from './quiz-content-access.service';

const mockPrismaService = {
  $transaction: jest.fn(),
  quiz: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  submission: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  question: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  listeningTranscriptReveal: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  listeningPracticeAttempt: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  userQuizReward: { createMany: jest.fn() },
  learningActivity: { create: jest.fn() },
  enrollment: { findFirst: jest.fn(), findMany: jest.fn() },
};

const mockAiService = {
  generateFeedback: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockSpeakingService = {
  generateTts: jest.fn(),
  generateDialogueTts: jest.fn(),
};

const mockUploadService = {
  uploadRawBuffer: jest.fn(),
  putPrivateObjectAtKey: jest.fn(),
  downloadFileBuffer: jest.fn(),
  downloadPrivateFileBuffer: jest.fn(),
  getPresignedDownloadUrl: jest.fn(),
  getPrivatePresignedDownloadUrl: jest.fn(),
  isPrivateStorageConfigured: jest.fn().mockReturnValue(true),
  privateObjectExists: jest.fn(),
};

const mockListeningAudioAuthoringService = {
  getCurrentPublishedArtifact: jest.fn().mockResolvedValue(null),
  getPublishedAudio: jest
    .fn()
    .mockRejectedValue(
      new Error('Audio toàn bài chưa được quản trị viên tạo và duyệt'),
    ),
};

const mockQuizContentAccessService = {
  assertAccess: jest.fn().mockResolvedValue(undefined),
  resolveMany: jest.fn().mockImplementation(
    (quizzes: Array<{ id: number; isPremiumContent?: boolean }>) =>
      new Map(
        quizzes.map((quiz) => [
          quiz.id,
          {
            isPremiumContent: Boolean(quiz.isPremiumContent),
            isLocked: false,
            featureKey: null,
          },
        ]),
      ),
  ),
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
        { provide: UploadService, useValue: mockUploadService },
        {
          provide: ListeningAudioAuthoringService,
          useValue: mockListeningAudioAuthoringService,
        },
        {
          provide: QuizContentAccessService,
          useValue: mockQuizContentAccessService,
        },
      ],
    }).compile();

    service = module.get<QuizService>(QuizService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockListeningAudioAuthoringService.getCurrentPublishedArtifact.mockResolvedValue(
      null,
    );
    mockListeningAudioAuthoringService.getPublishedAudio.mockRejectedValue(
      new Error('Audio toàn bài chưa được quản trị viên tạo và duyệt'),
    );
    mockQuizContentAccessService.assertAccess.mockResolvedValue(undefined);
    mockQuizContentAccessService.resolveMany.mockImplementation(
      (quizzes: Array<{ id: number; isPremiumContent?: boolean }>) =>
        new Map(
          quizzes.map((quiz) => [
            quiz.id,
            {
              isPremiumContent: Boolean(quiz.isPremiumContent),
              isLocked: false,
              featureKey: null,
            },
          ]),
        ),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Reading micro-skill analytics', () => {
    it.each([
      'DETAIL',
      'PURPOSE',
      'INFERENCE',
      'MAIN_IDEA',
      'VOCAB_IN_CONTEXT',
      'PROMOTION',
    ])('preserves the Reading skill %s', (skill) => {
      expect(resolveReadingMicroSkill('BILINGUAL_READING', { skill })).toBe(
        skill,
      );
    });

    it('uses Reading content precedence and a controlled fallback', () => {
      expect(
        resolveReadingMicroSkill('BILINGUAL_READING', {
          skill: 'detail',
          questionType: 'purpose',
          category: 'legacy',
        }),
      ).toBe('DETAIL');
      expect(
        resolveReadingMicroSkill('BILINGUAL_READING', {
          skill: 'READING',
          questionType: 'detail',
        }),
      ).toBe('DETAIL');
      expect(
        resolveReadingMicroSkill('BILINGUAL_READING', {
          questionType: 'purpose',
        }),
      ).toBe('PURPOSE');
      expect(
        resolveReadingMicroSkill('BILINGUAL_READING', { category: 'detail' }),
      ).toBe('DETAIL');
      expect(resolveReadingMicroSkill('BILINGUAL_READING', null)).toBe(
        'UNKNOWN',
      );
    });

    it('preserves the generic category fallback for non-Reading quizzes', () => {
      expect(
        resolveReadingMicroSkill('LISTENING_PRACTICE', {}, 'MULTIPLE_CHOICE'),
      ).toBe('MULTIPLE_CHOICE');
      expect(
        resolveReadingMicroSkill(
          'LISTENING_PRACTICE',
          { category: 'DICTATION' },
          'MULTIPLE_CHOICE',
        ),
      ).toBe('DICTATION');
    });
  });

  it('normalizes dialogue rows and drops incomplete rows', () => {
    expect(
      normalizeDialogueSegments([
        { speaker: ' Customer ', text: ' Hello ', translation: ' Xin chào ' },
        { speaker: '', text: 'ignored' },
        { speaker: 'Agent', text: ' How can I help? ' },
      ]),
    ).toEqual([
      { speaker: 'Customer', text: 'Hello', translation: 'Xin chào' },
      { speaker: 'Agent', text: 'How can I help?' },
    ]);
  });

  describe('getQuizById', () => {
    it('should return a quiz if it exists', async () => {
      const mockQuiz = { id: 1, title: 'Test Quiz', questions: [] };
      mockPrismaService.quiz.findUnique.mockResolvedValue(mockQuiz);

      const result = await service.getQuizById(1);

      expect(prisma.quiz.findUnique).toHaveBeenLastCalledWith({
        where: { id: 1 },
        include: {
          questions: {
            orderBy: { order: 'asc' },
            include: {
              audioAssets: {
                where: { isActive: true },
                orderBy: { version: 'desc' },
              },
              diagnosticClips: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
      });
      expect(result).toEqual(mockQuiz);
    });

    it('never serves TOEIC exam Writing tasks to guests or learners; admins keep them', async () => {
      const examTask = {
        id: 29,
        type: 'WRITING_PICTURE',
        publicationStatus: 'PUBLISHED',
        toeicWritingSetItems: [{ id: 1 }],
        questions: [{ id: 290, content: { prompt: 'Exam prompt' } }],
      };
      mockPrismaService.quiz.findUnique.mockResolvedValue(examTask);
      await expect(service.getQuizById(29)).rejects.toThrow(NotFoundException);
      await expect(
        service.getQuizById(29, false, 7, Role.STUDENT),
      ).rejects.toThrow(NotFoundException);
      const admin = await service.getQuizById(29, true, 1, Role.ADMIN);
      expect(admin.questions[0].content).toEqual({ prompt: 'Exam prompt' });
    });

    it('practice Writing quizzes (no exam link) are still served', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 17,
        type: 'WRITING_EMAIL',
        publicationStatus: 'PUBLISHED',
        toeicWritingSetItems: [],
        questions: [{ id: 81, content: { prompt: 'Practice prompt' } }],
      });
      const result = await service.getQuizById(17, false, 7, Role.STUDENT);
      expect(result.questions[0].content).toEqual({
        prompt: 'Practice prompt',
      });
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

    it('Writing: guests and learners get the learner contract; admins keep the authoring content', async () => {
      const writing = (type: string) => ({
        id: 17,
        type,
        publicationStatus: 'PUBLISHED',
        questions: [
          {
            id: 81,
            content: {
              prompt: 'Viết 40–60 từ.',
              wordRange: [40, 60],
              imageUrl: 'https://example.test/a.png',
              sampleResponse: 'Model answer.',
              sceneDescription: 'Authored scene.',
            },
          },
        ],
      });
      for (const type of ['WRITING_EMAIL', 'WRITING_PICTURE']) {
        for (const [userId, role] of [
          [undefined, undefined],
          [7, Role.STUDENT],
        ] as const) {
          mockPrismaService.quiz.findUnique.mockResolvedValue(writing(type));
          const result = await service.getQuizById(17, false, userId, role);
          expect(result.questions[0].content).toEqual({
            prompt: 'Viết 40–60 từ.',
            wordRange: [40, 60],
            imageUrl: 'https://example.test/a.png',
          });
        }
        mockPrismaService.quiz.findUnique.mockResolvedValue(writing(type));
        const admin = await service.getQuizById(17, true, 1, Role.ADMIN);
        expect(admin.questions[0].content).toMatchObject({
          sampleResponse: 'Model answer.',
        });
      }
    });

    it('delivers artifact timing without leaking a listening transcript before reveal', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 23,
        type: 'LISTENING_PRACTICE',
        publicationStatus: 'PUBLISHED',
        questions: [
          {
            id: 115,
            type: 'DICTATION',
            content: {
              targetTurnId: 'turn-001',
              correctAnswer: 'Hidden answer.',
              audioText: 'Hidden answer.',
              translation: 'Bản dịch chỉ được xem sau khi reveal.',
              transcriptSegments: [
                { text: 'Hidden answer.', translation: 'Đáp án ẩn' },
              ],
            },
          },
        ],
      });
      mockListeningAudioAuthoringService.getCurrentPublishedArtifact.mockResolvedValue(
        {
          id: 7,
          version: 7,
          checksumSha256: 'checksum',
          durationMs: 75528,
          timeline: [{ turnId: 'turn-001', startMs: 1200, endMs: 3400 }],
        },
      );

      const result = await service.getQuizById(23, false, 7);

      expect(result.questions[0].content).toEqual({ targetTurnId: 'turn-001' });
      expect((result.questions[0] as any).listeningSegment).toEqual({
        turnId: 'turn-001',
        startMs: 1200,
        endMs: 3400,
      });
    });

    it('requires a learner-owned reveal before serving dialogue transcripts', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 28,
        type: 'LISTENING_PRACTICE',
        isPremiumContent: false,
        courseId: null,
        publicationStatus: 'PUBLISHED',
      });
      mockPrismaService.question.findMany.mockResolvedValue([
        {
          id: 179,
          type: 'DIALOGUE',
          order: 1,
          content: {
            transcriptSegments: [
              {
                speaker: 'Customer',
                text: 'I need help.',
                translation: 'Tôi cần hỗ trợ.',
              },
              {
                speaker: 'Agent',
                text: 'I can help.',
                translation: 'Tôi có thể hỗ trợ.',
              },
            ],
          },
        },
      ]);
      mockPrismaService.listeningTranscriptReveal.findUnique.mockResolvedValue(
        null,
      );

      await expect(service.getListeningTranscript(7, 28)).rejects.toThrow(
        ForbiddenException,
      );
      expect(
        mockPrismaService.listeningTranscriptReveal.findUnique,
      ).toHaveBeenCalledWith({
        where: { userId_quizId: { userId: 7, quizId: 28 } },
        select: { id: true },
      });
    });

    it('serves dialogue transcript only after that learner has a reveal record', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 28,
        type: 'LISTENING_PRACTICE',
        isPremiumContent: false,
        courseId: null,
        publicationStatus: 'PUBLISHED',
      });
      mockPrismaService.question.findMany.mockResolvedValue([
        {
          id: 179,
          type: 'DIALOGUE',
          order: 1,
          content: {
            transcriptSegments: [
              {
                speaker: 'Customer',
                text: 'I need help.',
                translation: 'Tôi cần hỗ trợ.',
              },
              {
                speaker: 'Agent',
                text: 'I can help.',
                translation: 'Tôi có thể hỗ trợ.',
              },
            ],
          },
        },
      ]);
      mockPrismaService.listeningTranscriptReveal.findUnique.mockResolvedValue({
        id: 1,
      });

      const result = await service.getListeningTranscript(7, 28);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        questionId: 179,
        turnId: 'turn-001',
        speaker: 'Customer',
        transcript: 'I need help.',
      });
    });

    it('keeps Reading answer keys out of the pre-submission payload', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 10,
        type: 'BILINGUAL_READING',
        questions: [
          {
            id: 101,
            content: {
              text: 'Question',
              options: ['A', 'B'],
              correctIndex: 1,
              correct: 'B',
              correctAnswer: 'B',
              explanation: 'Hidden before submission',
            },
          },
        ],
      });

      const result = await service.getQuizById(10, false, 7);
      expect(result.questions[0].content).toEqual({
        text: 'Question',
        options: ['A', 'B'],
      });
    });

    it('blocks learner detail and submission access for an unpublished quiz', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 11,
        type: 'BILINGUAL_READING',
        publicationStatus: 'DRAFT',
      });

      await expect(service.getQuizById(11, true, 7)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Reading submission integrity', () => {
    const questions = [
      {
        id: 1,
        type: 'MULTIPLE_CHOICE',
        content: { options: ['A', 'B'], correctIndex: 1 },
      },
      {
        id: 2,
        type: 'MULTIPLE_CHOICE',
        content: { options: ['C', 'D'], correctIndex: 0 },
      },
    ];

    it.each([
      ['missing', [{ questionId: 1, answer: 'A' }]],
      [
        'duplicate',
        [
          { questionId: 1, answer: 'A' },
          { questionId: 1, answer: 'A' },
        ],
      ],
      [
        'unknown',
        [
          { questionId: 1, answer: 'A' },
          { questionId: 999, answer: 'C' },
        ],
      ],
      [
        'invalid option',
        [
          { questionId: 1, answer: 'Z' },
          { questionId: 2, answer: 'C' },
        ],
      ],
    ])(
      'rejects %s Reading submissions before persistence',
      (_label, answers) => {
        expect(() => validateReadingSubmission(questions, answers)).toThrow(
          BadRequestException,
        );
      },
    );

    it('accepts a complete Reading submission and creates one result per server question', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 24,
        title: 'Reading',
        type: 'BILINGUAL_READING',
        questions,
      });
      const tx = {
        submission: {
          create: jest.fn().mockResolvedValue({
            id: 77,
            results: [
              { questionId: 1, isCorrect: true },
              { questionId: 2, isCorrect: false },
            ],
          }),
        },
        learningActivity: {
          create: jest.fn().mockResolvedValue({ id: 501 }),
        },
      };
      mockPrismaService.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      mockPrismaService.userQuizReward.createMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.submitQuiz(24, 7, {
        answers: [
          { questionId: 1, answer: 'B' },
          { questionId: 2, answer: 'D' },
        ],
      });

      expect(tx.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            score: 1,
            results: {
              create: expect.arrayContaining([
                expect.objectContaining({ questionId: 1, isCorrect: true }),
                expect.objectContaining({ questionId: 2, isCorrect: false }),
              ]),
            },
          }),
        }),
      );
      expect(
        tx.submission.create.mock.calls[0][0].data.results.create,
      ).toHaveLength(2);
      expect(tx.learningActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 7,
          type: 'READING_PRACTICE_COMPLETED',
          sourceType: 'QUIZ',
          sourceId: '24',
          score: 50,
        }),
      });
      expect(result.id).toBe(77);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'quiz.submitted',
        expect.objectContaining({
          quizId: 24,
          score: 1,
          quizType: 'BILINGUAL_READING',
        }),
      );
    });

    it('replays a keyed Reading submission without duplicating rows or side effects', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 24,
        title: 'Reading',
        type: 'BILINGUAL_READING',
        questions,
      });
      mockPrismaService.submission.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      const tx = {
        submission: {
          create: jest.fn().mockResolvedValue({
            id: 90,
            results: [
              { questionId: 1, answer: 'B', isCorrect: true },
              { questionId: 2, answer: 'C', isCorrect: false },
            ],
          }),
        },
        learningActivity: { create: jest.fn().mockResolvedValue({ id: 601 }) },
      };
      mockPrismaService.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      mockPrismaService.userQuizReward.createMany.mockResolvedValue({
        count: 1,
      });

      await service.submitQuiz(24, 7, {
        clientAttemptId: '11111111-1111-4111-8111-111111111111',
        answers: [
          { questionId: 1, answer: 'B' },
          { questionId: 2, answer: 'C' },
        ],
      });

      expect(tx.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientAttemptId: '11111111-1111-4111-8111-111111111111',
          }),
        }),
      );

      jest.clearAllMocks();
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 24,
        title: 'Reading',
        type: 'BILINGUAL_READING',
        questions,
      });
      mockPrismaService.submission.findFirst.mockResolvedValue({
        id: 90,
        userId: 7,
        quizId: 24,
        clientAttemptId: '11111111-1111-4111-8111-111111111111',
        results: [
          { questionId: 1, answer: 'B' },
          { questionId: 2, answer: 'C' },
        ],
      });

      const replay = await service.submitQuiz(24, 7, {
        clientAttemptId: '11111111-1111-4111-8111-111111111111',
        answers: [
          { questionId: 2, answer: 'C' },
          { questionId: 1, answer: 'B' },
        ],
      });

      expect(replay.id).toBe(90);
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(
        mockPrismaService.userQuizReward.createMany,
      ).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('rejects a keyed replay with changed answers', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 24,
        title: 'Reading',
        type: 'BILINGUAL_READING',
        questions,
      });
      mockPrismaService.submission.findFirst.mockResolvedValue({
        id: 91,
        results: [
          { questionId: 1, answer: 'B' },
          { questionId: 2, answer: 'C' },
        ],
      });

      await expect(
        service.submitQuiz(24, 7, {
          clientAttemptId: '22222222-2222-4222-8222-222222222222',
          answers: [
            { questionId: 1, answer: 'A' },
            { questionId: 2, answer: 'C' },
          ],
        }),
      ).rejects.toThrow('ClientAttemptId');
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('recovers the winner after a concurrent idempotency unique conflict', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 24,
        title: 'Reading',
        type: 'BILINGUAL_READING',
        questions,
      });
      mockPrismaService.submission.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 92,
          results: [
            { questionId: 1, answer: 'B' },
            { questionId: 2, answer: 'C' },
          ],
        });
      const uniqueError = Object.assign(new Error('unique'), {
        code: 'P2002',
        meta: { target: ['userId', 'quizId', 'clientAttemptId'] },
      });
      mockPrismaService.$transaction.mockRejectedValue(uniqueError);

      await expect(
        service.submitQuiz(24, 7, {
          clientAttemptId: '33333333-3333-4333-8333-333333333333',
          answers: [
            { questionId: 1, answer: 'B' },
            { questionId: 2, answer: 'C' },
          ],
        }),
      ).resolves.toMatchObject({ id: 92 });
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('rejects invalid Reading submission without rows or success event', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 24,
        type: 'BILINGUAL_READING',
        questions,
      });

      await expect(
        service.submitQuiz(24, 7, {
          answers: [{ questionId: 1, answer: 'B' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(mockPrismaService.submission.create).not.toHaveBeenCalled();
      expect(mockPrismaService.learningActivity.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not emit success when the transaction fails', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 24,
        type: 'BILINGUAL_READING',
        questions,
      });
      mockPrismaService.$transaction.mockRejectedValue(
        new Error('database unavailable'),
      );

      await expect(
        service.submitQuiz(24, 7, {
          answers: [
            { questionId: 1, answer: 'B' },
            { questionId: 2, answer: 'C' },
          ],
        }),
      ).rejects.toThrow('database unavailable');
      expect(
        mockPrismaService.userQuizReward.createMany,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.learningActivity.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it.each(['TOEIC', 'TOEIC_FOUR_SKILL', 'WRITING_PICTURE', 'WRITING_EMAIL'])(
      'refuses a %s quiz, so repeated answers cannot inflate score or XP',
      async (type) => {
        mockPrismaService.quiz.findUnique.mockResolvedValue({
          id: 30,
          title: 'Not practice',
          type,
          questions: [
            {
              id: 301,
              type: 'MULTIPLE_CHOICE',
              content: { options: ['A', 'B'], correct: 'A' },
            },
          ],
        });
        mockPrismaService.$transaction.mockClear();
        mockEventEmitter.emit.mockClear();

        await expect(
          service.submitQuiz(30, 7, {
            answers: Array.from({ length: 50 }, () => ({
              questionId: 301,
              answer: 'A',
            })),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
        expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      },
    );

    it('keeps Listening activity creation outside the Reading transaction path', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 9,
        title: 'Listening',
        type: 'LISTENING_PRACTICE',
        questions: [
          {
            id: 91,
            type: 'MULTIPLE_CHOICE',
            content: { options: ['A', 'B'], correctIndex: 0 },
          },
        ],
      });
      const tx = {
        submission: {
          create: jest.fn().mockResolvedValue({ id: 78, results: [] }),
        },
      };
      mockPrismaService.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      mockPrismaService.userQuizReward.createMany.mockResolvedValue({
        count: 1,
      });

      await service.submitQuiz(9, 7, {
        answers: [{ questionId: 91, answer: 'A' }],
      });

      expect(tx.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            score: 1,
            results: {
              create: [
                expect.objectContaining({
                  questionId: 91,
                  answer: 'A',
                  isCorrect: true,
                  score: 1,
                }),
              ],
            },
          }),
        }),
      );
      expect(mockPrismaService.learningActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'LISTENING_PRACTICE_COMPLETED',
          sourceId: '9',
        }),
      });
    });

    it('uses the server Reading question count as analytics denominator', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValue({
        id: 88,
        quizId: 24,
        userId: 7,
        score: 1,
        quiz: {
          id: 24,
          title: 'Reading',
          type: 'BILINGUAL_READING',
          questions,
        },
        results: [{ questionId: 1, isCorrect: true }],
      });

      await expect(
        service.getSubmissionAnalytics(88, 7, Role.STUDENT),
      ).resolves.toMatchObject({
        totalQuestions: 2,
        totalCorrect: 1,
        overallAccuracyPercent: 50,
      });
    });

    it('reports Reading micro-skills instead of collapsing to MULTIPLE_CHOICE', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValue({
        id: 90,
        quizId: 24,
        userId: 7,
        score: 2,
        quiz: {
          id: 24,
          title: 'Reading',
          type: 'BILINGUAL_READING',
          questions: [
            {
              id: 1,
              type: 'MULTIPLE_CHOICE',
              content: { skill: 'READING', questionType: 'DETAIL' },
            },
            {
              id: 2,
              type: 'MULTIPLE_CHOICE',
              content: { questionType: 'PURPOSE' },
            },
          ],
        },
        results: [
          { questionId: 1, isCorrect: true },
          { questionId: 2, isCorrect: false },
        ],
      });

      await expect(
        service.getSubmissionAnalytics(90, 7, Role.STUDENT),
      ).resolves.toMatchObject({
        categoriesBreakdown: expect.arrayContaining([
          expect.objectContaining({ category: 'DETAIL', total: 1 }),
          expect.objectContaining({ category: 'PURPOSE', total: 1 }),
        ]),
      });
    });

    it('Writing analytics never return reference answers to the learner; admins keep them', async () => {
      const submission = () => ({
        id: 91,
        quizId: 17,
        userId: 7,
        score: 8,
        aiFeedback: null,
        quiz: {
          id: 17,
          title: 'Writing',
          type: 'WRITING_EMAIL',
          questions: [
            {
              id: 81,
              type: 'WRITING',
              content: { prompt: 'p1', sampleResponse: 'model 1' },
            },
            {
              id: 82,
              type: 'WRITING',
              content: {
                prompt: 'p2',
                sampleResponse: 'model 2',
                sceneDescription: 'scene',
              },
            },
          ],
        },
        results: [{ questionId: 81, answer: 'my text', score: 8 }],
      });
      mockPrismaService.submission.findUnique.mockResolvedValue(submission());
      const learner = await service.getSubmissionAnalytics(91, 7, Role.STUDENT);
      expect(JSON.stringify(learner)).not.toMatch(/model 1|model 2|scene/);
      expect(learner.questions.map((q: any) => q.content.prompt)).toEqual([
        'p1',
        'p2',
      ]);
      expect(learner.submittedAnswer).toBe('my text');
      mockPrismaService.submission.findUnique.mockResolvedValue(submission());
      const admin = await service.getSubmissionAnalytics(91, 1, Role.ADMIN);
      expect(JSON.stringify(admin)).toMatch(/model 1/);
    });

    it('preserves submission ownership checks for Reading analytics', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValue({
        id: 89,
        userId: 99,
        quiz: {
          id: 24,
          title: 'Reading',
          type: 'BILINGUAL_READING',
          questions,
        },
        results: [],
      });
      await expect(
        service.getSubmissionAnalytics(89, 7, Role.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listening practice checks', () => {
    it('builds natural dialogue audio without speaking speaker labels', () => {
      expect(
        buildNaturalListeningAudioText({
          audioText: 'Customer: Hello. Agent: How can I help?',
          transcriptSegments: [
            { speaker: 'Customer', text: 'Hello.' },
            { speaker: 'Agent', text: 'How can I help?' },
          ],
        }),
      ).toBe('Hello. How can I help?');

      expect(
        buildNaturalListeningAudioText({
          audioText: 'Customer: Hello. Agent: How can I help?',
        }),
      ).toBe('Hello. How can I help?');
    });

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

    it('does not leak the answer when dictation is submitted empty or incomplete', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 941,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        content: { correctAnswer: 'The meeting starts at nine tomorrow.' },
      });

      const result = await service.checkPracticeQuestion(23, 941, {
        answer: '',
      });
      expect(result.isCorrect).toBe(false);
      expect(result.submittedAnswer).toBe('');
      expect((result as any).correctAnswer).toBeUndefined();
      expect(result.tokens).toBeDefined();
      expect(result.tokens?.every((t) => t.status === 'MISSING')).toBe(true);
      expect(JSON.stringify(result)).not.toContain('tomorrow');
    });

    it('handles wrong inflection with masked token and relative grammar hint without leaking target word (Case A)', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 942,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        content: { correctAnswer: 'She drinks coffee every morning.' },
      });

      const result = await service.checkPracticeQuestion(23, 942, {
        answer: 'She drink coffee every morning.',
      });

      expect(result.isCorrect).toBe(false);
      expect((result as any).correctAnswer).toBeUndefined();
      expect(result.verifiedPrefix).toBe('She');
      expect(result.nextWordMask).toBe('******'); // 6 letters for drinks
      expect(result.hint).toContain('dạng động từ');
      expect(result.hint).toContain('She');
      // Critical negative assertion: target word 'drinks' must NOT be in the wrong attempt response
      expect(JSON.stringify(result)).not.toContain('drinks');
    });

    it('handles missing function word with masked token without leaking target word (Case B)', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 943,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        content: { correctAnswer: 'I go to school by bus.' },
      });

      const result = await service.checkPracticeQuestion(23, 943, {
        answer: 'I go school by bus.',
      });

      expect(result.isCorrect).toBe(false);
      expect((result as any).correctAnswer).toBeUndefined();
      expect(result.verifiedPrefix).toBe('I go');
      expect(result.nextWordMask).toBe('**'); // 2 letters for to
      expect(result.hint).toContain('giới từ');
      expect(JSON.stringify(result)).not.toMatch(/"text":"to"/);
    });

    it('marks extra word as EXTRA without shifting subsequent words into errors (Case C)', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 944,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        content: { correctAnswer: 'I like coffee.' },
      });

      const result = await service.checkPracticeQuestion(23, 944, {
        answer: 'I really like coffee.',
      });

      expect(result.isCorrect).toBe(false);
      expect(result.verifiedPrefix).toBe('I');
      expect(result.nextWordMask).toBe('****'); // 4 letters for like
      expect(result.nextErrorType).toBe('EXTRA');
      expect(result.hint).toContain('từ thừa');
    });

    it('canonicalizes submitted learner input progressively with punctuation restoration and idempotency', () => {
      const target = 'Hey, Liam. Are we still watching movie?';

      expect(canonicalizeSubmittedDictation(target, 'hey')).toBe('Hey,');
      expect(canonicalizeSubmittedDictation(target, 'hey liam')).toBe(
        'Hey, Liam.',
      );
      expect(
        canonicalizeSubmittedDictation(target, 'hey liam are we still watch'),
      ).toBe('Hey, Liam. Are we still watch');
      expect(
        canonicalizeSubmittedDictation(
          target,
          'hey liam are we still watching movie',
        ),
      ).toBe('Hey, Liam. Are we still watching movie?');
      expect(canonicalizeSubmittedDictation(target, 'HEY LIAM are WE')).toBe(
        'Hey, Liam. Are we',
      );
      expect(canonicalizeSubmittedDictation(target, 'Hey, Liam.')).toBe(
        'Hey, Liam.',
      );
      expect(canonicalizeSubmittedDictation("I'm ready.", 'im ready')).toBe(
        "I'm ready.",
      );
      expect(
        canonicalizeSubmittedDictation(
          'She drinks coffee every morning.',
          'she drink coffee',
        ),
      ).toBe('She drink coffee');
    });

    it('calculates exact letter counts and masks without punctuation or apostrophe leakage', () => {
      expect(getLexicalLetterCount('a')).toBe(1);
      expect(getLexicalLetterCount('to')).toBe(2);
      expect(getLexicalLetterCount('Are')).toBe(3);
      expect(getLexicalLetterCount('works')).toBe(5);
      expect(getLexicalLetterCount('drinks')).toBe(6);
      expect(getLexicalLetterCount('meeting')).toBe(7);
      expect(getLexicalLetterCount('Transportation')).toBe(14);
      expect(getLexicalLetterCount("don't")).toBe(4);
      expect(getLexicalLetterCount('part-time')).toBe(8);

      expect(maskExpectedWord('Are')).toBe('***');
      expect(maskExpectedWord('to')).toBe('**');
      expect(maskExpectedWord('meeting')).toBe('*******');
      expect(maskExpectedWord('Liam,')).toBe('****,');
      expect(maskExpectedWord('ready?')).toBe('*****?');
      expect(maskExpectedWord('meeting.')).toBe('*******.');
      expect(maskExpectedWord("don't")).toBe('****');
    });

    it('verifies controlled test cases 1 through 9 for progressive dictation feedback', () => {
      // Case 1: Short prefix
      const c1 = calculateProgressiveDictationFeedback(
        'Hey, Liam. Are we still meeting at the library on Saturday morning?',
        'hey liam',
      );
      expect(c1.isCorrect).toBe(false);
      expect(c1.verifiedPrefix).toBe('Hey, Liam.');
      expect(c1.nextWordMask).toBe('***'); // Are = 3 letters

      // Case 2: Later error
      const c2 = calculateProgressiveDictationFeedback(
        'Hey, Liam. Are we still meeting at the library on Saturday morning?',
        'hey liam are we still meet',
      );
      expect(c2.isCorrect).toBe(false);
      expect(c2.verifiedPrefix).toBe('Hey, Liam. Are we still');
      expect(c2.nextWordMask).toBe('*******'); // meeting = 7 letters

      // Case 3: Missing word
      const c3 = calculateProgressiveDictationFeedback(
        'I go to school by bus.',
        'i go school by bus',
      );
      expect(c3.isCorrect).toBe(false);
      expect(c3.verifiedPrefix).toBe('I go');
      expect(c3.nextWordMask).toBe('**'); // to = 2 letters

      // Case 4: Morphological error
      const c4 = calculateProgressiveDictationFeedback(
        'She drinks coffee every morning.',
        'she drink coffee every morning',
      );
      expect(c4.isCorrect).toBe(false);
      expect(c4.verifiedPrefix).toBe('She');
      expect(c4.nextWordMask).toBe('******'); // drinks = 6 letters

      // Case 5: Extra word
      const c5 = calculateProgressiveDictationFeedback(
        'I like coffee.',
        'i really like coffee',
      );
      expect(c5.isCorrect).toBe(false);
      expect(c5.verifiedPrefix).toBe('I');
      expect(c5.nextWordMask).toBe('****'); // like = 4 letters
      expect(c5.nextErrorType).toBe('EXTRA');
      expect(c5.hint).toContain('từ thừa');

      // Case 6: Fully correct with case and punctuation omitted by user
      const c6 = calculateProgressiveDictationFeedback(
        'Hey, Liam. Are you ready?',
        'hey liam are you ready',
      );
      expect(c6.isCorrect).toBe(true);
      expect(c6.verifiedPrefix).toBe('Hey, Liam. Are you ready?');
      expect(c6.nextWordMask).toBe('');

      // Case 7: Capitalization ignored during comparison
      const c7 = calculateProgressiveDictationFeedback(
        'Saturday is busy.',
        'saturday is busy',
      );
      expect(c7.isCorrect).toBe(true);
      expect(c7.verifiedPrefix).toBe('Saturday is busy.');

      // Case 8: Verb morphology error remains wrong
      const c8 = calculateProgressiveDictationFeedback(
        'She works here.',
        'she work here',
      );
      expect(c8.isCorrect).toBe(false);
      expect(c8.verifiedPrefix).toBe('She');
      expect(c8.nextWordMask).toBe('*****'); // works = 5 letters

      // Case 9: Empty input
      const c9 = calculateProgressiveDictationFeedback(
        'Transportation is available.',
        '',
      );
      expect(c9.isCorrect).toBe(false);
      expect(c9.verifiedPrefix).toBe('');
      expect(c9.nextWordMask).toBe('**************'); // Transportation = 14 letters
      expect(c9.hint).toContain('phần đầu câu');
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
      expect(normalizeListeningAnswer('  Don’t   worry!  ')).toBe(
        'do not worry',
      );
    });

    it('treats standard conversational punctuation and casing as non-lexical', () => {
      const expected = "Well, let me think. It's about ten minutes.";
      expect(normalizeListeningAnswer(expected)).toBe(
        normalizeListeningAnswer('well let me think its about ten minutes'),
      );
      expect(
        normalizeListeningAnswer('well let me think its about twenty minutes'),
      ).not.toBe(normalizeListeningAnswer(expected));
      expect(normalizeListeningAnswer('twenty-one minutes')).toBe(
        normalizeListeningAnswer('twenty one minutes'),
      );
    });

    it('treats canonical-aware contractions and full forms as equivalent', () => {
      const equivalentPairs = [
        ["We're going.", 'we are going'],
        ["We've finished.", 'we have finished'],
        ["We'll meet tomorrow.", 'we will meet tomorrow'],
        ["I can't come.", 'i cannot come'],
        ["We'd finished already.", 'we had finished already'],
        ["We'd like some help.", 'we would like some help'],
        ['We’re ready.', "we're ready"],
      ] as const;

      for (const [canonical, learner] of equivalentPairs) {
        expect(normalizeListeningAnswer(canonical)).toBe(
          normalizeListeningAnswer(learner),
        );
      }

      const rejectedPairs = [
        ["We're going.", "we've gone"],
        ["We've finished.", 'we had finished'],
        ["We'll meet tomorrow.", 'we would meet tomorrow'],
        ["We'd like some help.", 'we had like some help'],
        ['We’re ready.', 'were ready'],
      ] as const;

      for (const [canonical, learner] of rejectedPairs) {
        expect(normalizeListeningAnswer(canonical)).not.toBe(
          normalizeListeningAnswer(learner),
        );
      }
    });
  });

  describe('premium content projections', () => {
    it('returns locked Listening metadata without question content or media URLs', async () => {
      mockPrismaService.quiz.findMany.mockResolvedValue([
        {
          id: 41,
          courseId: null,
          practiceTopicId: 3,
          title: 'Premium dialogue',
          description: 'Metadata only',
          type: 'LISTENING_PRACTICE',
          bilingualContent: {
            mode: 'DIALOGUE',
            levels: ['B1'],
            transcript: 'Do not return this transcript',
          },
          timeLimit: 10,
          isPremiumContent: true,
          _count: { questions: 2 },
        },
      ]);
      mockQuizContentAccessService.resolveMany.mockResolvedValue(
        new Map([
          [41, { isPremiumContent: true, isLocked: true, featureKey: null }],
        ]),
      );

      const result = await service.getListeningPractices();

      expect(result).toEqual([
        expect.objectContaining({
          id: 41,
          isPremiumContent: true,
          isLocked: true,
          questionCount: 2,
        }),
      ]);
      expect(result[0]).not.toHaveProperty('bilingualContent');
      expect(result[0]).not.toHaveProperty('questions');
    });

    it('uses short-lived signed URLs for authorized premium Listening media', async () => {
      mockPrismaService.quiz.findUnique
        .mockResolvedValueOnce({
          id: 42,
          type: 'LISTENING_PRACTICE',
          isPremiumContent: true,
          courseId: null,
          publicationStatus: 'PUBLISHED',
        })
        .mockResolvedValueOnce({
          id: 42,
          type: 'LISTENING_PRACTICE',
          isPremiumContent: true,
          questions: [
            {
              id: 420,
              content: {},
              audioAssets: [
                {
                  key: 'premium/listening/quiz-42.mp3',
                  url: 'https://public/raw',
                },
              ],
              diagnosticClips: [],
            },
          ],
        });
      mockUploadService.getPrivatePresignedDownloadUrl.mockResolvedValue(
        'https://signed.example/premium-42',
      );

      const result = await service.getQuizById(42, false, 7);

      expect(result.questions[0].audioAssets[0].url).toBe(
        'https://signed.example/premium-42',
      );
      expect(
        mockUploadService.getPrivatePresignedDownloadUrl,
      ).toHaveBeenCalledWith('premium/listening/quiz-42.mp3', 300);
    });
  });

  describe('generateQuestionAudioAsset', () => {
    const tx = {
      quizAudioAsset: {
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 900, version: 1 }),
      },
      question: { update: jest.fn() },
    };
    beforeEach(() => {
      (mockPrismaService as any).quizAudioAsset = {
        aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
      };
      mockPrismaService.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      mockSpeakingService.generateTts.mockResolvedValue(Buffer.from('mp3'));
      mockUploadService.uploadRawBuffer.mockResolvedValue({
        key: 'catalog/listening/practice/audio/quiz-1/question-5/v1/audio.mp3',
        url: 'https://r2/x.mp3',
        contentType: 'audio/mpeg',
      });
    });

    it('reads a comprehension statement with one voice', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 5,
        type: 'MULTIPLE_CHOICE',
        quiz: { id: 1, type: 'LISTENING_PRACTICE', isPremiumContent: false },
        content: { audioText: 'The bus leaves at nine.', accent: 'UK' },
      });
      await service.generateQuestionAudioAsset(5);
      expect(mockSpeakingService.generateTts).toHaveBeenCalledWith(
        'The bus leaves at nine.',
        'UK',
        1,
      );
      expect(mockUploadService.uploadRawBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'audio/mpeg',
        'catalog/listening/practice/audio/quiz-1/question-5/v1',
        'audio.mp3',
      );
      expect(tx.quizAudioAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ questionId: 5, isActive: true }),
      });
    });

    it('reads the answer sentence of a dictation item', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 6,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE', isPremiumContent: false },
        content: { correctAnswer: 'The meeting starts at ten.' },
      });
      await service.generateQuestionAudioAsset(6);
      expect(mockSpeakingService.generateTts).toHaveBeenCalledWith(
        'The meeting starts at ten.',
        'US',
        1,
      );
    });

    it('refuses a question with nothing to read', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 7,
        type: 'MULTIPLE_CHOICE',
        quiz: { id: 1, type: 'LISTENING_PRACTICE', isPremiumContent: false },
        content: { text: 'Why?' },
      });
      await expect(service.generateQuestionAudioAsset(7)).rejects.toThrow(
        'chưa có câu để đọc',
      );
      expect(mockSpeakingService.generateTts).not.toHaveBeenCalled();
    });
  });

  describe('listening audio', () => {
    it('does not synthesize student audio from legacy content at request time', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 96,
        quizId: 28,
        quiz: { id: 28, type: 'LISTENING_PRACTICE' },
        audioAssets: [{ key: 'legacy/dialogue.mp3' }],
        content: {
          accent: 'US',
          audioText: 'Customer: Hello. Agent: How can I help?',
          transcriptSegments: [
            { speaker: 'Customer', text: 'Hello.' },
            { speaker: 'Agent', text: 'How can I help?' },
          ],
        },
      });
      await expect(service.streamQuestionAudio(28, 96)).rejects.toThrow(
        'Audio bài luyện chưa được quản trị viên tạo và duyệt',
      );
      expect(mockSpeakingService.generateDialogueTts).not.toHaveBeenCalled();
      expect(mockUploadService.downloadFileBuffer).not.toHaveBeenCalled();
    });

    it('plays the published conversation for a dialogue question with no own asset', async () => {
      const audio = Buffer.from('whole-conversation');
      const artifact = { id: 7, version: 2, checksumSha256: 'c2' };
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 130,
        quizId: 58,
        type: 'MULTIPLE_CHOICE',
        quiz: { id: 58, type: 'LISTENING_PRACTICE' },
        audioAssets: [],
        content: {
          text: 'Why does the patient visit?',
          transcriptSegments: [
            { speaker: 'Dr. Vance', text: 'Good morning.' },
            { speaker: 'Ms. Holloway', text: 'Thank you, Doctor.' },
          ],
        },
      });
      mockListeningAudioAuthoringService.getCurrentPublishedArtifact.mockResolvedValue(
        artifact,
      );
      mockListeningAudioAuthoringService.getPublishedAudio.mockResolvedValue({
        artifact,
        buffer: audio,
      });

      await expect(service.streamQuestionAudio(58, 130)).resolves.toEqual({
        artifact,
        buffer: audio,
      });
      expect(
        mockListeningAudioAuthoringService.getPublishedAudio,
      ).toHaveBeenCalledWith(58, {});
    });

    it('still refuses a dialogue question when neither an asset nor a published recording exists', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 131,
        quizId: 47,
        type: 'MULTIPLE_CHOICE',
        quiz: { id: 47, type: 'LISTENING_PRACTICE' },
        audioAssets: [],
        content: {
          transcriptSegments: [
            { speaker: 'A', text: 'Hi.' },
            { speaker: 'B', text: 'Hello.' },
          ],
        },
      });
      mockListeningAudioAuthoringService.getCurrentPublishedArtifact.mockResolvedValue(
        null,
      );

      await expect(service.streamQuestionAudio(47, 131)).rejects.toThrow(
        'Audio bài luyện chưa được quản trị viên tạo và duyệt',
      );
    });

    it('keeps using a static asset for non-dialogue listening questions', async () => {
      const audio = Buffer.from('stored-audio');
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 97,
        quizId: 9,
        quiz: { id: 9, type: 'LISTENING_PRACTICE' },
        audioAssets: [{ key: 'catalog/listening/question-97.mp3' }],
        content: { audioText: 'The shop opens at nine.' },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValue(audio);

      await expect(service.streamQuestionAudio(9, 97)).resolves.toBe(audio);
      expect(mockUploadService.downloadFileBuffer).toHaveBeenCalledWith(
        'catalog/listening/question-97.mp3',
      );
      expect(mockSpeakingService.generateTts).not.toHaveBeenCalled();
    });

    it('serves premium question audio only through the private storage path', async () => {
      const audio = Buffer.from('private-audio');
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 101,
        quizId: 41,
        quiz: {
          id: 41,
          type: 'LISTENING_PRACTICE',
          isPremiumContent: true,
        },
        audioAssets: [
          { key: 'premium/listening/quiz-41/question-101/v1/audio.mp3' },
        ],
        content: { audioText: 'A protected sentence.' },
      });
      mockUploadService.downloadPrivateFileBuffer.mockResolvedValue(audio);

      await expect(service.streamQuestionAudio(41, 101)).resolves.toBe(audio);
      expect(mockUploadService.downloadPrivateFileBuffer).toHaveBeenCalledWith(
        'premium/listening/quiz-41/question-101/v1/audio.mp3',
      );
      expect(mockUploadService.downloadFileBuffer).not.toHaveBeenCalled();
    });

    it('rejects premium question audio that still points at public storage', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 102,
        quizId: 41,
        quiz: {
          id: 41,
          type: 'LISTENING_PRACTICE',
          isPremiumContent: true,
        },
        audioAssets: [{ key: 'catalog/listening/question-102.mp3' }],
        content: { audioText: 'A legacy public sentence.' },
      });

      await expect(service.streamQuestionAudio(41, 102)).rejects.toThrow(
        'Premium Listening media is not stored in private storage',
      );
      expect(
        mockUploadService.downloadPrivateFileBuffer,
      ).not.toHaveBeenCalled();
      expect(mockUploadService.downloadFileBuffer).not.toHaveBeenCalled();
    });

    it('serves an approved dictation asset without synthesizing at playback time', async () => {
      const audio = Buffer.from('speaker-line-audio');
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 99,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        audioAssets: [
          {
            key: 'catalog/listening/practice/audio/quiz-23/question-99/v1.mp3',
          },
        ],
        content: {
          accent: 'US',
          speaker: 'Daniel',
          audioText: 'The meeting starts at ten.',
          correctAnswer: 'The meeting starts at ten.',
        },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValue(audio);

      await expect(service.streamQuestionAudio(23, 99)).resolves.toBe(audio);
      expect(mockSpeakingService.generateDialogueTts).not.toHaveBeenCalled();
      expect(mockUploadService.downloadFileBuffer).toHaveBeenCalledWith(
        'catalog/listening/practice/audio/quiz-23/question-99/v1.mp3',
      );
    });

    it('serves a generated catalog dialogue asset without re-synthesizing it', async () => {
      const audio = Buffer.from('stored-dialogue-audio');
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 98,
        quizId: 28,
        quiz: { id: 28, type: 'LISTENING_PRACTICE' },
        audioAssets: [
          {
            key: 'catalog/listening/practice/dialogue/quiz-28/question-98/v1/asset.mp3',
          },
        ],
        content: {
          accent: 'US',
          transcriptSegments: [
            { speaker: 'Customer', text: 'Hello.' },
            { speaker: 'Agent', text: 'How can I help?' },
          ],
        },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValue(audio);

      await expect(service.streamQuestionAudio(28, 98)).resolves.toBe(audio);
      expect(mockUploadService.downloadFileBuffer).toHaveBeenCalledWith(
        'catalog/listening/practice/dialogue/quiz-28/question-98/v1/asset.mp3',
      );
      expect(mockSpeakingService.generateDialogueTts).not.toHaveBeenCalled();
    });

    it('binds dictation playback to the current quiz-level artifact identity', async () => {
      const audio = Buffer.from('quiz-track-v5');
      const artifact = {
        id: 15,
        version: 5,
        checksumSha256: 'checksum-v5',
        durationMs: 94627,
        timeline: [{ turnId: 'turn-001', startMs: 0, endMs: 2500 }],
      };
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 120,
        quizId: 24,
        type: 'DICTATION',
        quiz: { id: 24, type: 'LISTENING_PRACTICE' },
        audioAssets: [],
        content: {
          targetTurnId: 'turn-001',
          transcriptSegments: [{ text: 'Hey, Ben.' }],
        },
      });
      mockListeningAudioAuthoringService.getCurrentPublishedArtifact.mockResolvedValue(
        artifact,
      );
      mockListeningAudioAuthoringService.getPublishedAudio.mockResolvedValue({
        artifact,
        buffer: audio,
      });

      const result = await service.streamQuestionAudio(24, 120, {
        artifactId: 15,
        version: 5,
        checksumSha256: 'checksum-v5',
      });

      expect(result).toEqual({ artifact, buffer: audio });
      expect(
        mockListeningAudioAuthoringService.getPublishedAudio,
      ).toHaveBeenCalledWith(24, {
        artifactId: 15,
        version: 5,
        checksumSha256: 'checksum-v5',
      });
      expect(mockUploadService.downloadFileBuffer).not.toHaveBeenCalled();
    });

    it('fails closed when an artifact-backed question has no valid timeline turn', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 120,
        quizId: 24,
        type: 'DICTATION',
        quiz: { id: 24, type: 'LISTENING_PRACTICE' },
        audioAssets: [],
        content: { targetTurnId: 'turn-002' },
      });
      mockListeningAudioAuthoringService.getCurrentPublishedArtifact.mockResolvedValue(
        {
          id: 15,
          version: 5,
          checksumSha256: 'checksum-v5',
          durationMs: 94627,
          timeline: [{ turnId: 'turn-001', startMs: 0, endMs: 2500 }],
        },
      );

      await expect(service.streamQuestionAudio(24, 120)).rejects.toThrow(
        'Audio toàn bài chưa có mốc thời gian hợp lệ cho câu này',
      );
      expect(
        mockListeningAudioAuthoringService.getPublishedAudio,
      ).not.toHaveBeenCalled();
    });

    it('does not downgrade an identity-bound request to a legacy clip', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 121,
        quizId: 24,
        type: 'DICTATION',
        quiz: { id: 24, type: 'LISTENING_PRACTICE' },
        audioAssets: [
          {
            key: 'catalog/listening/practice/audio/quiz-24/question-121/v1.mp3',
          },
        ],
        content: { targetTurnId: 'turn-002' },
      });

      await expect(
        service.streamQuestionAudio(24, 121, { artifactId: 15, version: 5 }),
      ).rejects.toThrow('Audio phiên bản hiện tại chưa được quản trị viên tạo');
      expect(mockUploadService.downloadFileBuffer).not.toHaveBeenCalled();
    });

    it('fails closed when a full-script R2 artifact is not available', async () => {
      mockPrismaService.quiz.findUnique.mockResolvedValue({
        id: 23,
        type: 'LISTENING_PRACTICE',
        publicationStatus: 'PUBLISHED',
        questions: [
          {
            content: {
              accent: 'UK',
              correctAnswer: 'First line.',
              speaker: 'Maya',
            },
          },
          { content: { correctAnswer: 'Second line.', speaker: 'Daniel' } },
          { content: { correctAnswer: 'Third line.', speaker: 'Maya' } },
        ],
      });
      await expect(service.streamListeningTranscriptAudio(23)).rejects.toThrow(
        'Audio toàn bài chưa được quản trị viên tạo và duyệt',
      );
      expect(mockSpeakingService.generateDialogueTts).not.toHaveBeenCalled();
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
