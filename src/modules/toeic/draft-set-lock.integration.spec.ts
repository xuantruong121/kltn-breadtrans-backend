import { ConflictException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { AdminExamService } from './admin-exam.service';
import { ExamWritingService } from './exam-writing.service';

/**
 * Exam content written while the exam is being published (audit A8
 * follow-up, 2026-11-18). The draft check ran a few milliseconds before the
 * write, so a publish in between had a group added under learners.
 */
describeWithIsolatedDatabase('inDraftSet PostgreSQL', () => {
  let prisma: PrismaService;
  let service: AdminExamService;
  const setIds: number[] = [];
  const sw: {
    examIds: number[];
    assessmentIds: number[];
    writingSetIds: number[];
  } = { examIds: [], assessmentIds: [], writingSetIds: [] };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new AdminExamService(prisma);
  });

  afterAll(async () => {
    const items = await prisma.toeicWritingSetItem.findMany({
      where: { writingSetId: { in: sw.writingSetIds } },
      select: { writingQuizId: true },
    });
    await prisma.toeicWritingSetItem.deleteMany({
      where: { writingSetId: { in: sw.writingSetIds } },
    });
    await prisma.quiz.deleteMany({
      where: { id: { in: items.map((row) => row.writingQuizId) } },
    });
    await prisma.toeicAssessmentComponent.deleteMany({
      where: { assessmentId: { in: sw.assessmentIds } },
    });
    await prisma.toeicAssessment.deleteMany({
      where: { id: { in: sw.assessmentIds } },
    });
    await prisma.exam.deleteMany({ where: { id: { in: sw.examIds } } });
    await prisma.toeicWritingSet.deleteMany({
      where: { id: { in: sw.writingSetIds } },
    });
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

  it('a Writing task saved while the exam is published waits, then gets 409; nothing is written (2026-11-18)', async () => {
    const tag = `draft-lock-sw ${Date.now()}`;
    const writingSet = await prisma.toeicWritingSet.create({
      data: { title: tag },
    });
    sw.writingSetIds.push(writingSet.id);
    const exam = await prisma.exam.create({
      data: {
        title: tag,
        familyCode: 'TOEIC',
        variantCode: 'TOEIC_SW',
        templateKey: 'TOEIC_SW_V1',
      },
    });
    sw.examIds.push(exam.id);
    const assessment = await prisma.toeicAssessment.create({
      data: {
        title: tag,
        productFamily: 'TOEIC_SW',
        examId: exam.id,
        components: {
          create: { kind: 'WRITING', order: 2, writingSetId: writingSet.id },
        },
      },
    });
    sw.assessmentIds.push(assessment.id);
    const writing = new ExamWritingService(prisma, {
      getAdmin: jest.fn(),
    } as never);

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    // A publish holding the exam row, as GenericExamService.publish does.
    const publish = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Exam" WHERE id = ${exam.id} FOR UPDATE`;
        locked();
        await held;
        await tx.exam.update({
          where: { id: exam.id },
          data: { publicationStatus: 'PUBLISHED' },
        });
      },
      { timeout: 15_000 },
    );
    await lockTaken;

    // The early check reads DRAFT: the publish has not committed yet.
    const save = writing.saveSlot(exam.id, 8, {
      title: 'Bài luận',
      prompt: 'Viết về học trực tuyến',
    });
    const settled = save.then(
      () => 'resolved',
      () => 'rejected',
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await publish;

    await expect(save).rejects.toBeInstanceOf(ConflictException);
    await settled;
    expect(
      await prisma.toeicWritingSetItem.count({
        where: { writingSetId: writingSet.id },
      }),
    ).toBe(0);
  });
});
