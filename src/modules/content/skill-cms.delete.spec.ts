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
});
