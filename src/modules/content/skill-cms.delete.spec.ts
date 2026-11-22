import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { SkillCmsService } from './skill-cms.service';

/** DELETE /admin/skill-content/:domain/:id (owner 2026-11-17). */
describe('SkillCmsService.deleteContent', () => {
  const admin = { id: 7, role: Role.ADMIN };

  const speakingPrisma = (
    over: { scope?: string; recordings?: number; found?: boolean } = {},
  ) => {
    const prisma: any = {
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue(
          over.found === false
            ? null
            : {
                id: 'speaking-1',
                scope: over.scope ?? 'SKILL_PRACTICE',
                publicationStatus: 'PUBLISHED',
              },
        ),
        delete: jest.fn().mockReturnValue('delete-set'),
      },
      speakingSubmission: {
        count: jest.fn().mockResolvedValue(over.recordings ?? 0),
      },
      speakingExercise: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockReturnValue('delete-exercises'),
      },
      // The row locks of the delete paths (audit A5): SELECT ... FOR UPDATE.
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    return prisma;
  };

  const quizPrisma = (
    over: {
      status?: string;
      submissions?: number;
      examItems?: number;
      found?: boolean;
    } = {},
  ) => {
    const prisma: any = {
      quiz: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            over.found === false
              ? null
              : { id: 31, publicationStatus: over.status ?? 'DRAFT' },
          ),
        delete: jest.fn().mockResolvedValue({ id: 31 }),
      },
      submission: { count: jest.fn().mockResolvedValue(over.submissions ?? 0) },
      toeicWritingSetItem: {
        count: jest.fn().mockResolvedValue(over.examItems ?? 0),
      },
      contentTrackTag: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      quizAudioAsset: { findMany: jest.fn().mockResolvedValue([]) },
      listeningAudioArtifact: { findMany: jest.fn().mockResolvedValue([]) },
      // The row locks of the delete paths (audit A5): SELECT ... FOR UPDATE.
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    return prisma;
  };

  it('deletes a speaking set with no recordings: exercises first, then the set', async () => {
    const prisma = speakingPrisma();
    await expect(
      new SkillCmsService(prisma).deleteContent(
        'speaking',
        'speaking-1',
        admin,
      ),
    ).resolves.toEqual({
      id: 'speaking-1',
      deleted: true,
    });
    expect(prisma.speakingExercise.deleteMany).toHaveBeenCalledWith({
      where: { practiceSetId: 'speaking-1' },
    });
    expect(prisma.speakingPracticeSet.delete).toHaveBeenCalledWith({
      where: { id: 'speaking-1' },
    });
    // Exercises first: practiceSet on SpeakingExercise is SetNull.
    expect(
      prisma.speakingExercise.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      prisma.speakingPracticeSet.delete.mock.invocationCallOrder[0],
    );
    // Set and exercises locked before the recordings are counted (audit A5).
    expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      prisma.speakingSubmission.count.mock.invocationCallOrder[0],
    );
  });

  it('refuses a speaking set that learners recorded on, and an exam set', async () => {
    for (const prisma of [
      speakingPrisma({ recordings: 2 }),
      speakingPrisma({ scope: 'EXAM_INTERNAL' }),
    ]) {
      await expect(
        new SkillCmsService(prisma).deleteContent(
          'speaking',
          'speaking-1',
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.speakingExercise.deleteMany).not.toHaveBeenCalled();
      expect(prisma.speakingPracticeSet.delete).not.toHaveBeenCalled();
    }
  });

  it('answers 404 for an unknown set or quiz', async () => {
    await expect(
      new SkillCmsService(speakingPrisma({ found: false })).deleteContent(
        'speaking',
        'nope',
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      new SkillCmsService(quizPrisma({ found: false })).deleteContent(
        'reading',
        '31',
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes a draft quiz with no submission', async () => {
    const prisma = quizPrisma();
    await new SkillCmsService(prisma).deleteContent('listening', '31', admin);
    expect(prisma.quiz.delete).toHaveBeenCalledWith({ where: { id: 31 } });
    // Its tags go too: they have no foreign key to the quiz.
    expect(prisma.contentTrackTag.deleteMany).toHaveBeenCalledWith({
      where: { contentType: 'QUIZ', contentId: 31 },
    });
  });

  it('refuses a published quiz, a quiz with submissions, and a TOEIC writing task', async () => {
    for (const prisma of [
      quizPrisma({ status: 'PUBLISHED' }),
      quizPrisma({ submissions: 1 }),
      quizPrisma({ examItems: 1 }),
    ]) {
      await expect(
        new SkillCmsService(prisma).deleteContent('writing', '31', admin),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.quiz.delete).not.toHaveBeenCalled();
      expect(prisma.contentTrackTag.deleteMany).not.toHaveBeenCalled();
    }
  });

  it('a recording saved while one Speaking exercise is deleted keeps the exercise (audit A5)', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      // The recording landed after the first count.
      speakingSubmission: { count: jest.fn().mockResolvedValue(1) },
      speakingExercise: { delete: jest.fn() },
    };
    const prisma: any = {
      speakingExercise: {
        findFirst: jest.fn().mockResolvedValue({ id: 31, practiceSetId: 's1' }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    };

    await expect(
      new SkillCmsService(prisma).deleteSpeakingExercise(
        'speaking',
        's1',
        '31',
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.speakingExercise.delete).not.toHaveBeenCalled();
  });

  it('requires an admin', async () => {
    await expect(
      new SkillCmsService(quizPrisma()).deleteContent('reading', '31', {
        id: 1,
        role: Role.STUDENT,
      }),
    ).rejects.toThrow();
  });

  /** Bug 2026-11-22: the item's own R2 files go after the commit. */
  describe('R2 files', () => {
    const withFiles = (prisma: unknown) => {
      const files = { removeFiles: jest.fn().mockResolvedValue({}) };
      const service = new SkillCmsService(
        prisma as never,
        undefined,
        undefined,
        undefined,
        undefined,
        files as never,
      );
      return { service, files };
    };
    const quiz31 = { kind: 'listening-quiz', quizId: 31 };

    it('a listening quiz: every clip version and artifact, read before the delete, removed after it', async () => {
      const prisma = quizPrisma();
      const clip = 'catalog/listening/practice/audio/quiz-31/question-9/v1/a';
      prisma.quizAudioAsset.findMany.mockResolvedValue([
        { key: `${clip}.mp3` },
        { key: `${clip}2.mp3` },
      ]);
      prisma.listeningAudioArtifact.findMany.mockResolvedValue([
        { r2Key: 'catalog/listening/practice/quiz-31/audio/v1/full.mp3' },
        { r2Key: null },
      ]);
      const { service, files } = withFiles(prisma);

      await expect(
        service.deleteContent('listening', '31', admin),
      ).resolves.toEqual({ id: 31, deleted: true });

      expect(prisma.quizAudioAsset.findMany).toHaveBeenCalledWith({
        where: { question: { quizId: 31 } },
        select: { key: true },
      });
      expect(files.removeFiles).toHaveBeenCalledWith([
        { owner: quiz31, stored: `${clip}.mp3` },
        { owner: quiz31, stored: `${clip}2.mp3` },
        {
          owner: quiz31,
          stored: 'catalog/listening/practice/quiz-31/audio/v1/full.mp3',
        },
        { owner: quiz31, stored: null },
      ]);
      // Rows read before the cascade; files removed after the transaction.
      expect(
        prisma.quizAudioAsset.findMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.quiz.delete.mock.invocationCallOrder[0]);
      expect(
        prisma.contentTrackTag.deleteMany.mock.invocationCallOrder[0],
      ).toBeLessThan(files.removeFiles.mock.invocationCallOrder[0]);
    });

    it('a reading or writing quiz has no server file to remove', async () => {
      const prisma = quizPrisma();
      const { service, files } = withFiles(prisma);

      await service.deleteContent('reading', '31', admin);

      expect(prisma.quizAudioAsset.findMany).not.toHaveBeenCalled();
      expect(files.removeFiles).not.toHaveBeenCalled();
    });

    it('a refused delete removes no file', async () => {
      const prisma = quizPrisma({ status: 'PUBLISHED' });
      prisma.quizAudioAsset.findMany.mockResolvedValue([{ key: 'k' }]);
      const { service, files } = withFiles(prisma);

      await expect(
        service.deleteContent('listening', '31', admin),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(files.removeFiles).not.toHaveBeenCalled();
    });

    it('a file that cannot go never fails the delete', async () => {
      const prisma = quizPrisma();
      prisma.quizAudioAsset.findMany.mockResolvedValue([{ key: 'k' }]);
      const { service, files } = withFiles(prisma);
      files.removeFiles.mockRejectedValue(new Error('R2 down'));

      await expect(
        service.deleteContent('listening', '31', admin),
      ).resolves.toEqual({ id: 31, deleted: true });
    });

    it('a speaking set: the reference audio of each exercise', async () => {
      const prisma = speakingPrisma();
      prisma.speakingExercise.findMany.mockResolvedValue([
        { id: 5, audioUrl: 'premium/speaking/reference/5.r1.mp3' },
        { id: 6, audioUrl: null },
      ]);
      const { service, files } = withFiles(prisma);

      await service.deleteContent('speaking', 'speaking-1', admin);

      expect(files.removeFiles).toHaveBeenCalledWith([
        {
          owner: { kind: 'speaking-exercise', exerciseId: 5 },
          stored: 'premium/speaking/reference/5.r1.mp3',
        },
        { owner: { kind: 'speaking-exercise', exerciseId: 6 }, stored: null },
      ]);
      expect(
        prisma.speakingPracticeSet.delete.mock.invocationCallOrder[0],
      ).toBeLessThan(files.removeFiles.mock.invocationCallOrder[0]);
    });

    const exercisePrisma = () => {
      const deleted = { id: 31, audioUrl: 'premium/speaking/reference/31.r1' };
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
        speakingExercise: {
          findFirst: jest.fn().mockResolvedValue({ id: 31 }),
          delete: jest.fn().mockResolvedValue(deleted),
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          update: jest.fn(),
        },
      };
      const prisma: any = {
        speakingExercise: {
          findFirst: jest.fn().mockResolvedValue({ id: 31 }),
        },
        speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
        $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
      };
      return { prisma, tx, deleted };
    };

    it('one speaking exercise: its reference audio after the commit', async () => {
      const { prisma, deleted } = exercisePrisma();
      const { service, files } = withFiles(prisma);

      await service.deleteSpeakingExercise('speaking', 's1', '31', admin);

      expect(files.removeFiles).toHaveBeenCalledWith([
        {
          owner: { kind: 'speaking-exercise', exerciseId: 31 },
          stored: deleted.audioUrl,
        },
      ]);
    });

    it("an exam's exercise: nothing until the exam's transaction commits", async () => {
      const { prisma, tx } = exercisePrisma();
      const { service, files } = withFiles(prisma);

      await service.deleteSpeakingExercise('speaking', 's1', '31', admin, tx);

      expect(files.removeFiles).not.toHaveBeenCalled();
    });

    const questionPrisma = () => ({
      question: {
        findFirst: jest.fn().mockResolvedValue({ id: 415, quizId: 103 }),
        delete: jest.fn().mockResolvedValue({ id: 415 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
      quizAudioAsset: {
        findMany: jest.fn().mockResolvedValue([
          {
            key: 'catalog/listening/practice/audio/quiz-103/question-415/v1/a.mp3',
          },
        ]),
      },
    });

    it('a listening question: its own clips, read before the delete', async () => {
      const prisma = questionPrisma();
      const { service, files } = withFiles(prisma);

      await service.deleteQuestion('listening', '103', '415', admin);

      expect(prisma.quizAudioAsset.findMany).toHaveBeenCalledWith({
        where: { questionId: 415 },
        select: { key: true },
      });
      expect(files.removeFiles).toHaveBeenCalledWith([
        {
          owner: { kind: 'listening-question', quizId: 103, questionId: 415 },
          stored:
            'catalog/listening/practice/audio/quiz-103/question-415/v1/a.mp3',
        },
      ]);
      expect(prisma.question.delete.mock.invocationCallOrder[0]).toBeLessThan(
        files.removeFiles.mock.invocationCallOrder[0],
      );
    });

    it('a reading question: its images are generic uploads and stay', async () => {
      const prisma = questionPrisma();
      const { service, files } = withFiles(prisma);

      await service.deleteQuestion('reading', '103', '415', admin);

      expect(prisma.question.delete).toHaveBeenCalled();
      expect(prisma.quizAudioAsset.findMany).not.toHaveBeenCalled();
      expect(files.removeFiles).not.toHaveBeenCalled();
    });
  });
});
