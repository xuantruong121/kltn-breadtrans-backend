import { ForbiddenException } from '@nestjs/common';
import { QuizPublicationStatus, Role, QuizType } from '@prisma/client';
import { validate } from 'class-validator';
import { SkillCmsService } from './skill-cms.service';
import {
  SpeakingExerciseDto,
  SpeakingExerciseReorderDto,
} from './skill-cms.dto';

describe('SkillCmsService', () => {
  const admin = { id: 7, role: Role.ADMIN };

  it('requires an admin for domain content access', async () => {
    const service = new SkillCmsService({} as any);
    await expect(
      service.list('reading', { id: 1, role: Role.STUDENT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps new quiz content in DRAFT and binds it to the domain type', async () => {
    const prisma = {
      quiz: {
        create: jest.fn().mockResolvedValue({
          id: 11,
          publicationStatus: QuizPublicationStatus.DRAFT,
          type: QuizType.BILINGUAL_READING,
        }),
      },
    };
    const service = new SkillCmsService(prisma as any);
    await service.create('reading', { title: 'QA Reading' }, admin);
    expect(prisma.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: QuizType.BILINGUAL_READING,
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      }),
    );
  });

  it('rejects a Reading publish preflight with an invalid answer index', async () => {
    const prisma = {
      quiz: {
        findFirst: jest.fn().mockResolvedValue({
          id: 12,
          title: 'Reading',
          theoryContent: 'Passage',
          questions: [
            {
              id: 1,
              type: 'MULTIPLE_CHOICE',
              content: { options: ['A'], correctIndex: 2 },
              order: 0,
            },
          ],
          _count: { submissions: 0 },
        }),
      },
    };
    const service = new SkillCmsService(prisma as any);
    const result = await service.validate('reading', '12', admin);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('options/correctIndex');
  });

  describe('editing a Listening question', () => {
    const setup = (content: Record<string, unknown>) => {
      const prisma = {
        question: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 5, type: 'MULTIPLE_CHOICE', content }),
          update: jest.fn().mockResolvedValue({ id: 5 }),
        },
        submission: { count: jest.fn().mockResolvedValue(0) },
        quizAudioAsset: { updateMany: jest.fn() },
      };
      return { prisma, service: new SkillCmsService(prisma as any) };
    };

    it('retires the clip when the spoken sentence changes', async () => {
      const { prisma, service } = setup({
        audioText: 'The bus leaves at nine.',
      });
      await service.updateListeningQuestion(
        '1',
        '5',
        {
          type: 'MULTIPLE_CHOICE',
          content: { audioText: 'The bus leaves at ten.' },
        },
        admin,
      );
      expect(prisma.quizAudioAsset.updateMany).toHaveBeenCalledWith({
        where: { questionId: 5, isActive: true },
        data: { isActive: false },
      });
    });

    it('keeps the clip when only the question wording changes', async () => {
      const { prisma, service } = setup({
        audioText: 'The bus leaves at nine.',
        text: 'When?',
      });
      await service.updateListeningQuestion(
        '1',
        '5',
        { type: 'MULTIPLE_CHOICE', content: { text: 'What time?' } },
        admin,
      );
      expect(prisma.quizAudioAsset.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('Listening publish needs audio a learner can play', () => {
    const mcq = (id: number, extra: Record<string, unknown> = {}) => ({
      id,
      type: 'MULTIPLE_CHOICE',
      content: { options: ['a', 'b', 'c', 'd'], correctIndex: 1, ...extra },
      audioAssets: [],
      order: id,
    });
    const turns = [
      { speaker: 'A', text: 'Hi.' },
      { speaker: 'B', text: 'Hello.' },
    ];
    const run = async (questions: unknown[], recording: unknown) => {
      const prisma = {
        quiz: {
          findFirst: jest.fn().mockResolvedValue({
            id: 58,
            title: 'Hội thoại C1 — A visit',
            questions,
            _count: { submissions: 0 },
          }),
        },
      };
      const authoring = {
        getCurrentPublishedArtifact: jest.fn().mockResolvedValue(recording),
      };
      const service = new SkillCmsService(prisma as any, authoring as any);
      return service.validate('listening', '58', admin);
    };

    it('refuses a dialogue quiz with no recording and no clips', async () => {
      const result = await run(
        [
          mcq(1, { transcriptSegments: turns }),
          mcq(2, { transcriptSegments: turns }),
        ],
        null,
      );
      expect(result.errors).toEqual([
        'Câu 1: chưa có audio cho học viên',
        'Câu 2: chưa có audio cho học viên',
      ]);
    });

    it('accepts a dialogue quiz whose conversation recording is published', async () => {
      const result = await run([mcq(1, { transcriptSegments: turns })], {
        id: 3,
        version: 1,
      });
      expect(result.valid).toBe(true);
    });

    it('needs a clip per question when questions do not share a conversation', async () => {
      const result = await run(
        [
          {
            ...mcq(1, { audioText: 'The bus leaves at nine.' }),
            audioAssets: [{ isActive: true }],
          },
          mcq(2, { audioText: 'The shop is closed.' }),
        ],
        { id: 3, version: 1 },
      );
      expect(result.errors).toEqual(['Câu 2: chưa có audio cho học viên']);
    });
  });

  it('does not let a content PATCH bypass publish preflight', async () => {
    const prisma = {
      quiz: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 13, type: QuizType.BILINGUAL_READING }),
        update: jest.fn().mockResolvedValue({ id: 13 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);
    await service.update(
      'reading',
      '13',
      {
        title: 'Reading',
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      },
      admin,
    );
    expect(prisma.quiz.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        }),
      }),
    );
  });

  it('creates Speaking practice sets and exercises as DRAFT', async () => {
    const tx = {
      speakingExercise: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: 1,
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    const prisma = {
      speakingPracticeSet: {
        create: jest.fn().mockResolvedValue({
          id: 'speaking-qa',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'speaking-qa',
          category: 'COMMUNICATION',
          level: 'BEGINNER',
        }),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SkillCmsService(prisma as any);

    await service.create(
      'speaking',
      {
        title: 'Speaking QA',
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      },
      admin,
    );
    await service.addSpeakingExercise(
      'speaking',
      'speaking-qa',
      {
        title: 'Prompt',
        targetText: 'Good morning.',
        taskType: 'READ_ALOUD',
      },
      admin,
    );

    expect(prisma.speakingPracticeSet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      }),
    );
    expect(tx.speakingExercise.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      }),
    );
  });

  it('publishes a valid Speaking set and all of its exercises together', async () => {
    const set = {
      id: 'speaking-ready',
      title: 'Speaking Ready',
      exercises: [
        {
          id: 1,
          title: 'Prompt',
          targetText: 'Hello.',
          taskType: 'READ_ALOUD',
        },
      ],
    };
    const tx = {
      speakingPracticeSet: {
        update: jest.fn().mockResolvedValue({
          ...set,
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        }),
      },
      speakingExercise: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      speakingPracticeSet: { findUnique: jest.fn().mockResolvedValue(set) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SkillCmsService(prisma as any);

    await service.publish(
      'speaking',
      'speaking-ready',
      QuizPublicationStatus.PUBLISHED,
      admin,
    );

    expect(tx.speakingPracticeSet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      }),
    );
    expect(tx.speakingExercise.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      }),
    );
  });

  it('blocks Speaking edits after learner history exists', async () => {
    const prisma = {
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({ id: 'speaking-used' }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(1) },
    };
    const service = new SkillCmsService(prisma as any);
    await expect(
      service.update('speaking', 'speaking-used', { title: 'Changed' }, admin),
    ).rejects.toThrow('lịch sử làm bài');
  });

  it('rejects duplicate or foreign ids in Speaking reorder requests', async () => {
    const prisma = {
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'speaking-order',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
      speakingExercise: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
      $transaction: jest.fn(),
    };
    const service = new SkillCmsService(prisma as any);

    await expect(
      service.reorderSpeakingExercises(
        'speaking',
        'speaking-order',
        { exerciseIds: [1, 1] },
        admin,
      ),
    ).rejects.toThrow('đúng một lần toàn bộ câu');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validates positive integer order DTOs', async () => {
    const exercise = Object.assign(new SpeakingExerciseDto(), { order: 0 });
    const reorder = Object.assign(new SpeakingExerciseReorderDto(), {
      exerciseIds: [-1],
    });

    expect(await validate(exercise)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'order' })]),
    );
    expect(await validate(reorder)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'exerciseIds' }),
      ]),
    );
  });

  it('assigns contiguous authoritative order during Speaking reorder', async () => {
    const tx = {
      speakingExercise: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        update: jest.fn().mockResolvedValue({}),
      },
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'speaking-order',
          exercises: [
            { id: 2, order: 1 },
            { id: 1, order: 2 },
          ],
        }),
      },
    };
    const prisma = {
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'speaking-order',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
      speakingExercise: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SkillCmsService(prisma as any);

    await service.reorderSpeakingExercises(
      'speaking',
      'speaking-order',
      { exerciseIds: [2, 1] },
      admin,
    );

    expect(tx.speakingExercise.updateMany).toHaveBeenCalledWith({
      where: { practiceSetId: 'speaking-order' },
      data: { order: null },
    });
    expect(tx.speakingExercise.update).toHaveBeenNthCalledWith(1, {
      where: { id: 2 },
      data: { order: 1 },
    });
    expect(tx.speakingExercise.update).toHaveBeenNthCalledWith(2, {
      where: { id: 1 },
      data: { order: 2 },
    });
  });

  it('stores Writing task fields in the learner runtime content shape', async () => {
    const prisma = {
      quiz: { findFirst: jest.fn().mockResolvedValue({ id: 21 }) },
      question: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);

    await service.addWritingQuestion(
      '21',
      {
        type: 'WRITING',
        taskType: 'EMAIL',
        prompt: 'Write an email.',
        level: 'B1',
        keywords: ['reply', 'confirm'],
        wordRange: [100, 130],
        sampleSentences: ['Dear team,'],
      },
      admin,
    );

    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'WRITING',
        content: {
          skill: 'WRITING',
          taskType: 'EMAIL',
          prompt: 'Write an email.',
          level: 'B1',
          keywords: ['reply', 'confirm'],
          wordRange: [100, 130],
          sampleSentences: ['Dear team,'],
        },
      }),
    });
  });

  it('rejects a Writing task family that contradicts its parent format', async () => {
    const prisma = {
      quiz: {
        findFirst: jest.fn().mockResolvedValue({
          id: 22,
          type: QuizType.WRITING_PICTURE,
        }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
      question: { findFirst: jest.fn() },
    };
    const service = new SkillCmsService(prisma as any);

    await expect(
      service.addWritingQuestion(
        '22',
        {
          type: 'WRITING',
          taskType: 'EMAIL',
          prompt: 'Write a response.',
        },
        admin,
      ),
    ).rejects.toThrow('task family của dạng tranh');
    expect(prisma.question.findFirst).not.toHaveBeenCalled();
  });

  it('restores Speaking child category from the parent when an override is removed', async () => {
    const prisma = {
      speakingExercise: {
        findFirst: jest.fn().mockResolvedValue({
          id: 42,
          category: 'BUSINESS',
          difficulty: 'ADVANCED',
          practiceSet: { category: 'COMMUNICATION' },
        }),
        update: jest.fn().mockResolvedValue({ id: 42 }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);

    await service.updateSpeakingExercise(
      'speaking',
      'set-42',
      '42',
      { title: 'Updated', targetText: 'Hello again.' },
      admin,
    );

    expect(prisma.speakingExercise.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'COMMUNICATION',
        }),
      }),
    );
  });

  it('exposes Listening audio authoring only for a question owned by the quiz', async () => {
    const prisma = {
      question: { findFirst: jest.fn().mockResolvedValue({ id: 8 }) },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    const audio = {
      validateContent: jest.fn().mockResolvedValue({ valid: true }),
      generatePreview: jest.fn(),
      listArtifacts: jest.fn(),
      approve: jest.fn(),
      publish: jest.fn(),
    };
    const quiz = {
      createAudioAsset: jest.fn().mockResolvedValue({ id: 9 }),
      generateDialogueAudioAsset: jest.fn(),
    };
    const service = new SkillCmsService(
      prisma as any,
      audio as any,
      quiz as any,
    );
    const file = {
      buffer: Buffer.from('audio'),
      mimetype: 'audio/mpeg',
    } as any;

    await service.uploadListeningQuestionAudio(4, 8, file, admin);

    expect(prisma.question.findFirst).toHaveBeenCalledWith({
      where: { id: 8, quizId: 4, quiz: { type: QuizType.LISTENING_PRACTICE } },
      select: { id: true },
    });
    expect(quiz.createAudioAsset).toHaveBeenCalledWith(8, file);
  });

  it('blocks Listening media mutation after learner history exists', async () => {
    const prisma = {
      question: { findFirst: jest.fn().mockResolvedValue({ id: 8 }) },
      submission: { count: jest.fn().mockResolvedValue(1) },
    };
    const quiz = { createAudioAsset: jest.fn() };
    const service = new SkillCmsService(prisma as any, {} as any, quiz as any);

    await expect(
      service.uploadListeningQuestionAudio(
        4,
        8,
        { buffer: Buffer.from('audio'), mimetype: 'audio/mpeg' } as any,
        admin,
      ),
    ).rejects.toThrow('lịch sử làm bài');
    expect(quiz.createAudioAsset).not.toHaveBeenCalled();
  });
});

describe('Speaking reference audio follows the sample sentence', () => {
  const admin = { id: 7, role: Role.ADMIN };
  const exercise = {
    id: 30,
    practiceSetId: 'set-1',
    targetText: 'Hello, my name is Alex.',
    taskType: 'READ_ALOUD',
    imageUrl: null,
    stimulusId: null,
    stimulus: null,
    isPremiumContent: false,
    audioUrl: 'https://pub/catalog/speaking/reference/30.v1.mp3',
    practiceSet: { category: 'WORK', categoryId: 1 },
  };
  const prismaWith = () => ({
    speakingExercise: {
      findFirst: jest.fn().mockResolvedValue(exercise),
      update: jest
        .fn()
        .mockImplementation(({ data }) => ({ ...exercise, ...data })),
    },
    speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
  });

  it('clears the reference audio when the sentence changes', async () => {
    const prisma = prismaWith();
    const service = new SkillCmsService(prisma as any);
    await service.updateSpeakingExercise(
      'speaking',
      'set-1',
      '30',
      { targetText: 'Hi, I am Alex.' } as any,
      admin,
    );
    expect(
      prisma.speakingExercise.update.mock.calls[0][0].data.audioUrl,
    ).toBeNull();
  });

  it('keeps the reference audio when the sentence is unchanged', async () => {
    const prisma = prismaWith();
    const service = new SkillCmsService(prisma as any);
    await service.updateSpeakingExercise(
      'speaking',
      'set-1',
      '30',
      { title: 'Greeting', targetText: 'Hello, my name is Alex.' },
      admin,
    );
    expect(
      prisma.speakingExercise.update.mock.calls[0][0].data.audioUrl,
    ).toBeUndefined();
  });

  it('synthesizes a free reference clip to a new public key', async () => {
    const prisma = prismaWith();
    const speaking = {
      generateTts: jest.fn().mockResolvedValue(Buffer.from('mp3')),
    };
    const upload = {
      putObjectAtKey: jest.fn().mockImplementation((key: string) => ({
        key,
        url: `https://pub/${key}`,
      })),
      putPrivateObjectAtKey: jest.fn(),
      isPrivateStorageConfigured: jest.fn().mockReturnValue(true),
    };
    const service = new SkillCmsService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      speaking as any,
      upload as any,
    );
    await service.generateSpeakingReferenceAudio('set-1', '30', admin);
    expect(speaking.generateTts).toHaveBeenCalledWith(
      'Hello, my name is Alex.',
      'US',
      1,
    );
    const key = upload.putObjectAtKey.mock.calls[0][0] as string;
    expect(key).toMatch(/^catalog\/speaking\/reference\/30\.r\d+\.mp3$/);
    expect(prisma.speakingExercise.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { audioUrl: `https://pub/${key}` },
    });
  });

  it('stores a premium reference clip privately and saves its key', async () => {
    const prisma = prismaWith();
    prisma.speakingExercise.findFirst.mockResolvedValue({
      ...exercise,
      isPremiumContent: true,
    });
    const speaking = {
      generateTts: jest.fn().mockResolvedValue(Buffer.from('mp3')),
    };
    const upload = {
      putObjectAtKey: jest.fn(),
      putPrivateObjectAtKey: jest.fn(),
      isPrivateStorageConfigured: jest.fn().mockReturnValue(true),
    };
    const service = new SkillCmsService(
      prisma as any,
      undefined,
      undefined,
      undefined,
      speaking as any,
      upload as any,
    );
    await service.generateSpeakingReferenceAudio('set-1', '30', admin);
    const key = upload.putPrivateObjectAtKey.mock.calls[0][0] as string;
    expect(key).toMatch(/^premium\/speaking\/reference\/30\.r\d+\.mp3$/);
    expect(prisma.speakingExercise.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { audioUrl: key },
    });
  });
});
