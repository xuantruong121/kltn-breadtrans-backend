import { NotFoundException } from '@nestjs/common';

import {
  ExamNotDraftException,
  inDraftExam,
  inDraftSet,
} from './draft-set-lock';

describe('inDraftSet (audit A8 follow-up)', () => {
  const build = (set: unknown) => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      toeicExamSet: { findUnique: jest.fn().mockResolvedValue(set) },
    };
    const prisma: any = {
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    };
    return { prisma, tx };
  };

  it('locks the set row, then runs the write on the same transaction', async () => {
    const { prisma, tx } = build({
      publicationStatus: 'DRAFT',
      genericExam: { publicationStatus: 'DRAFT' },
    });
    const work = jest.fn().mockResolvedValue('written');

    await expect(inDraftSet(prisma, 4, work)).resolves.toBe('written');
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(work).toHaveBeenCalledWith(tx);
  });

  it.each([
    ['the set', { publicationStatus: 'PUBLISHED', genericExam: null }],
    [
      'its exam',
      {
        publicationStatus: 'DRAFT',
        genericExam: { publicationStatus: 'PUBLISHED' },
      },
    ],
  ])(
    'refuses with 409 once %s left Draft; the write never runs',
    async (_, set) => {
      const { prisma } = build(set);
      const work = jest.fn();

      await expect(inDraftSet(prisma, 4, work)).rejects.toBeInstanceOf(
        ExamNotDraftException,
      );
      expect(work).not.toHaveBeenCalled();
    },
  );

  it('a deleted set is not found', async () => {
    const { prisma } = build(null);

    await expect(inDraftSet(prisma, 4, jest.fn())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('inDraftExam (Speaking and Writing sections)', () => {
  const build = (exam: unknown) => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      exam: { findUnique: jest.fn().mockResolvedValue(exam) },
    };
    const prisma: any = {
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    };
    return { prisma, tx };
  };

  it('locks the exam row, then runs the write on the same transaction', async () => {
    const { prisma, tx } = build({ publicationStatus: 'DRAFT' });
    const work = jest.fn().mockResolvedValue('written');

    await expect(inDraftExam(prisma, 9, work)).resolves.toBe('written');
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FROM "Exam"');
    expect(work).toHaveBeenCalledWith(tx);
  });

  it('refuses with 409 once the exam left Draft; the write never runs', async () => {
    const { prisma } = build({ publicationStatus: 'PUBLISHED' });
    const work = jest.fn();

    await expect(inDraftExam(prisma, 9, work, 'Viết')).rejects.toThrow(
      new ExamNotDraftException('Viết'),
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('a deleted exam is not found', async () => {
    const { prisma } = build(null);

    await expect(inDraftExam(prisma, 9, jest.fn())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
