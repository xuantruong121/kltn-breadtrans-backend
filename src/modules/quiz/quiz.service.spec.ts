import { Test, TestingModule } from '@nestjs/testing';
import {
  buildNaturalListeningAudioText,
  normalizeDialogueSegments,
  normalizeListeningAnswer,
  QuizService,
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
  userQuizReward: { createMany: jest.fn() },
  learningActivity: { create: jest.fn() },
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
  downloadFileBuffer: jest.fn(),
};

const mockListeningAudioAuthoringService = {
  getCurrentPublishedArtifact: jest.fn().mockResolvedValue(null),
  getPublishedAudio: jest
    .fn()
    .mockRejectedValue(
      new Error('Audio toàn bài chưa được quản trị viên tạo và duyệt'),
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
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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

      expect(prisma.quiz.findUnique).toHaveBeenCalledWith({
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
      expect(result.id).toBe(77);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'quiz.submitted',
        expect.objectContaining({ quizId: 24, score: 1 }),
      );
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
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
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

    it('returns feedback and the answer when dictation is submitted empty', async () => {
      mockPrismaService.question.findUnique.mockResolvedValue({
        id: 941,
        quizId: 23,
        type: 'DICTATION',
        quiz: { id: 23, type: 'LISTENING_PRACTICE' },
        content: { correctAnswer: 'The meeting starts at nine tomorrow.' },
      });

      await expect(
        service.checkPracticeQuestion(23, 941, { answer: '' }),
      ).resolves.toMatchObject({
        isCorrect: false,
        submittedAnswer: '',
        correctAnswer: 'The meeting starts at nine tomorrow.',
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
