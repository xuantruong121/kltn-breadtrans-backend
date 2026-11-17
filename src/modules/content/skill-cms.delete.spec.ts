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
      $transaction: jest.fn().mockResolvedValue([]),
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
  ) => ({
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
  });

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
    expect(prisma.$transaction).toHaveBeenCalledWith([
      'delete-exercises',
      'delete-set',
    ]);
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
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
      new SkillCmsService(quizPrisma({ found: false }) as any).deleteContent(
        'reading',
        '31',
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes a draft quiz with no submission', async () => {
    const prisma = quizPrisma();
    await new SkillCmsService(prisma as any).deleteContent(
      'listening',
      '31',
      admin,
    );
    expect(prisma.quiz.delete).toHaveBeenCalledWith({ where: { id: 31 } });
  });

  it('refuses a published quiz, a quiz with submissions, and a TOEIC writing task', async () => {
    for (const prisma of [
      quizPrisma({ status: 'PUBLISHED' }),
      quizPrisma({ submissions: 1 }),
      quizPrisma({ examItems: 1 }),
    ]) {
      await expect(
        new SkillCmsService(prisma as any).deleteContent(
          'writing',
          '31',
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.quiz.delete).not.toHaveBeenCalled();
    }
  });

  it('requires an admin', async () => {
    await expect(
      new SkillCmsService(quizPrisma() as any).deleteContent('reading', '31', {
        id: 1,
        role: Role.STUDENT,
      }),
    ).rejects.toThrow();
  });
});
