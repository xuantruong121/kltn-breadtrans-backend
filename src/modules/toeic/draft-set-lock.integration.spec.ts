import { ConflictException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { AdminExamService } from './admin-exam.service';

/**
 * Exam content written while the exam is being published (audit A8
 * follow-up, 2026-11-18). The draft check ran a few milliseconds before the
 * write, so a publish in between had a group added under learners.
 */
describeWithIsolatedDatabase('inDraftSet PostgreSQL', () => {
  let prisma: PrismaService;
  let service: AdminExamService;
  const setIds: number[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new AdminExamService(prisma);
  });

  afterAll(async () => {
    await prisma.toeicExamSet.deleteMany({ where: { id: { in: setIds } } });
    await prisma.$disconnect();
  });

  it('a group added while the exam is published waits, then gets 409; nothing is written', async () => {
    const set = await prisma.toeicExamSet.create({
      data: { title: `draft-lock ${Date.now()}`, type: 'PRACTICE_BY_PART' },
    });
    setIds.push(set.id);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    // A publish holding the set row, as GenericExamService.publish does.
    const publish = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ToeicExamSet" WHERE id = ${set.id} FOR UPDATE`;
        locked();
        await held;
        await tx.toeicExamSet.update({
          where: { id: set.id },
          data: { publicationStatus: 'PUBLISHED' },
        });
      },
      { timeout: 15_000 },
    );
    await lockTaken;

    // The early check reads DRAFT: the publish has not committed yet.
    const add = service.addGroup(set.id, { part: 5, groupOrder: 1 });
    const settled = add.then(
      () => 'resolved',
      () => 'rejected',
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await publish;

    await expect(add).rejects.toBeInstanceOf(ConflictException);
    await settled;
    expect(
      await prisma.toeicQuestionGroup.count({ where: { examId: set.id } }),
    ).toBe(0);
  });
});
