import { BadRequestException, ConflictException } from '@nestjs/common';
import { QuizPublicationStatus } from '@prisma/client';
import { ExamWritingService } from './exam-writing.service';

describe('ExamWritingService', () => {
  const item = (order: number, taskKind: string) => ({
    order,
    taskKind,
    writingQuizId: 100 + order,
    writingQuiz: {
      title: `Câu ${order}`,
      questions: [
        {
          id: 200 + order,
          content: {
            prompt: 'Đề cũ',
            imageUrl: 'https://pub-test.r2.dev/a.png',
            keywords: ['a', 'b'],
          },
        },
      ],
    },
  });
  const full = [
    ...[1, 2, 3, 4, 5].map((order) => item(order, 'PICTURE_SENTENCE')),
    item(6, 'WRITTEN_REQUEST'),
    item(7, 'WRITTEN_REQUEST'),
    item(8, 'OPINION_ESSAY'),
  ];
  const build = (
    status: QuizPublicationStatus = QuizPublicationStatus.DRAFT,
    items: unknown[] = [],
  ) => {
    const tx = {
      quiz: { create: jest.fn().mockResolvedValue({ id: 500 }) },
      toeicWritingSetItem: { create: jest.fn() },
    };
    const prisma = {
      exam: {
        findUnique: jest.fn().mockResolvedValue({
          id: 3,
          publicationStatus: status,
          toeicAssessment: { components: [{ writingSetId: 9 }] },
        }),
      },
      toeicWritingSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          publicationStatus: QuizPublicationStatus.DRAFT,
          items,
        }),
        update: jest.fn(),
      },
      quiz: { update: jest.fn(), updateMany: jest.fn() },
      question: { update: jest.fn() },
      $transaction: jest.fn((work: unknown) =>
        typeof work === 'function'
          ? (work as (value: typeof tx) => unknown)(tx)
          : Promise.resolve(work),
      ),
    };
    const exams = { getAdmin: jest.fn().mockResolvedValue({ id: 3 }) };
    return {
      prisma,
      tx,
      exams,
      service: new ExamWritingService(prisma as never, exams as never),
    };
  };
  const essay = { title: 'Bài luận', prompt: 'Viết về học trực tuyến' };

  it('lists all 8 slots even when the section is empty', async () => {
    const { service } = build();

    const result = await service.get(3);

    expect(result.slots).toHaveLength(8);
    expect(result.slots[7]).toMatchObject({
      taskKind: 'OPINION_ESSAY',
      filled: false,
    });
    expect(result.editable).toBe(true);
  });

  it('creates a task that belongs only to this exam', async () => {
    const { service, tx } = build();

    await service.saveSlot(3, 8, essay);

    const created = tx.quiz.create.mock.calls[0][0].data;
    expect(created.practiceTopicId).toBeUndefined();
    expect(created.publicationStatus).toBe(QuizPublicationStatus.DRAFT);
    expect(tx.toeicWritingSetItem.create).toHaveBeenCalledWith({
      data: {
        writingSetId: 9,
        order: 8,
        taskKind: 'OPINION_ESSAY',
        writingQuizId: 500,
      },
    });
  });

  it('updates the task in place when the slot is filled', async () => {
    const { service, prisma, tx } = build(undefined, full);

    await service.saveSlot(3, 8, essay);

    expect(tx.quiz.create).not.toHaveBeenCalled();
    expect(prisma.quiz.update).toHaveBeenCalledWith({
      where: { id: 108 },
      data: { title: 'Bài luận' },
    });
    expect(prisma.question.update).toHaveBeenCalled();
  });

  it('refuses to edit an exam that is not a draft', async () => {
    const { service, tx } = build(QuizPublicationStatus.PUBLISHED);

    await expect(service.saveSlot(3, 8, essay)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.quiz.create).not.toHaveBeenCalled();
  });

  it('refuses a ninth slot', async () => {
    const { service } = build();

    await expect(service.saveSlot(3, 9, essay)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('publishes the tasks with the set once all 8 are ready', async () => {
    const { service, prisma } = build(undefined, full);

    await service.publish(3);

    expect(prisma.quiz.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [101, 102, 103, 104, 105, 106, 107, 108] } },
      data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
    });
    expect(prisma.toeicWritingSet.update).toHaveBeenCalled();
  });

  it('refuses to publish an incomplete section', async () => {
    const { service, prisma } = build(undefined, full.slice(0, 7));

    await expect(service.publish(3)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.quiz.updateMany).not.toHaveBeenCalled();
  });
});
