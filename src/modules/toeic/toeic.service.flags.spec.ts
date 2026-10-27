import { BadRequestException } from '@nestjs/common';
import { AttemptMode, AttemptStatus } from '@prisma/client';
import { ToeicService } from './toeic.service';

/**
 * Review flags and cleared answers on PATCH /toeic/attempts/:id/answers.
 * An answer-only save used to reset the flags to [] (lost on mock attempt
 * 40); a restored checkpoint could not remove answers given after it.
 */
describe('ToeicService.saveAnswers — flags and cleared answers', () => {
  let prisma: any;
  let service: ToeicService;
  const question = (id: number, part: number) => ({
    id,
    options: ['a', 'b', 'c'],
    group: { part },
  });
  const attempt = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    userId: 7,
    examId: 50,
    mode: AttemptMode.PRACTICE,
    status: AttemptStatus.IN_PROGRESS,
    section: null,
    selectedParts: [],
    markedQuestionIds: [5],
    deadline: new Date(Date.now() + 3_600_000),
    readingDeadline: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((cb: (tx: any) => unknown) => cb(prisma)),
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      toeicAttempt: { findUnique: jest.fn(), update: jest.fn() },
      toeicAttemptAnswer: { deleteMany: jest.fn() },
      toeicQuestion: { findMany: jest.fn(), count: jest.fn() },
    };
    service = new ToeicService(prisma, {} as any);
    prisma.toeicAttempt.findUnique.mockResolvedValue(attempt());
  });

  it('an answer-only save leaves the saved flags untouched', async () => {
    prisma.toeicQuestion.findMany.mockResolvedValue([question(6, 1)]);
    await service.saveAnswers(1, 7, { answers: { '6': 1 } });
    const data = prisma.toeicAttempt.update.mock.calls[0][0].data;
    expect('markedQuestionIds' in data).toBe(false);
  });

  it('an explicit [] clears the flags; an array replaces them', async () => {
    prisma.toeicQuestion.findMany.mockResolvedValue([]);
    prisma.toeicQuestion.count.mockResolvedValue(0);
    await service.saveAnswers(1, 7, { answers: {}, markedQuestionIds: [] });
    expect(prisma.toeicAttempt.update.mock.calls[0][0].data).toMatchObject({
      markedQuestionIds: [],
    });
    prisma.toeicQuestion.count.mockResolvedValue(2);
    await service.saveAnswers(1, 7, {
      answers: {},
      markedQuestionIds: [8, 9, 9],
    });
    expect(prisma.toeicAttempt.update.mock.calls[1][0].data).toMatchObject({
      markedQuestionIds: [8, 9],
    });
  });

  it('flags outside the selected Parts are refused before any write', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      attempt({ selectedParts: [2] }),
    );
    prisma.toeicQuestion.findMany.mockResolvedValue([]);
    prisma.toeicQuestion.count.mockResolvedValue(0);
    await expect(
      service.saveAnswers(1, 7, { answers: {}, markedQuestionIds: [101] }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.toeicQuestion.count.mock.calls[0][0].where.group).toEqual({
      examId: 50,
      part: { in: [2] },
    });
    expect(prisma.toeicAttempt.update).not.toHaveBeenCalled();
  });

  it('null clears a saved answer; other answers are upserted', async () => {
    prisma.toeicQuestion.findMany.mockResolvedValue([
      question(103, 5),
      question(104, 5),
    ]);
    await service.saveAnswers(1, 7, { answers: { '103': null, '104': 2 } });
    expect(prisma.toeicAttemptAnswer.deleteMany).toHaveBeenCalledWith({
      where: { attemptId: 1, questionId: { in: [103] } },
    });
    // The upsert carries only the chosen answer.
    const upsert = prisma.$executeRaw.mock.calls.find((c: any[]) =>
      String(c[0].join('')).includes('INSERT INTO "ToeicAttemptAnswer"'),
    );
    expect(JSON.stringify(upsert[1])).toContain('104');
    expect(JSON.stringify(upsert[1])).not.toContain('103');
  });

  it('an out-of-range answer is still refused', async () => {
    prisma.toeicQuestion.findMany.mockResolvedValue([question(104, 5)]);
    await expect(
      service.saveAnswers(1, 7, { answers: { '104': 3 } }),
    ).rejects.toThrow(BadRequestException);
  });
});
