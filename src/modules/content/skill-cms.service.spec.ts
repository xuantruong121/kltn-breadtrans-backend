import { ForbiddenException } from '@nestjs/common';
import { QuizPublicationStatus, Role, QuizType } from '@prisma/client';
import { SkillCmsService } from './skill-cms.service';

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
      speakingExercise: {
        create: jest.fn().mockResolvedValue({
          id: 1,
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      },
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
      { title: 'Prompt', targetText: 'Good morning.' },
      admin,
    );

    expect(prisma.speakingPracticeSet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      }),
    );
    expect(prisma.speakingExercise.create).toHaveBeenCalledWith(
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
      exercises: [{ id: 1, title: 'Prompt', targetText: 'Hello.' }],
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
