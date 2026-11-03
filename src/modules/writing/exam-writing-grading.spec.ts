import { WritingService } from './writing.service';
import {
  EXAM_WRITING_GIVE_UP_AFTER_MS,
  EXAM_WRITING_MAX_TRIES,
  examWritingGaveUp,
  examWritingTries,
} from './exam-writing-grading';

const stored = (over: Record<string, unknown> = {}) => ({
  id: 70,
  userId: 7,
  score: null,
  clientAttemptId: 'assessment-5-40',
  aiFeedback: null,
  results: [{ answer: 'Dear team, I can attend the meeting on Friday.' }],
  quiz: {
    id: 40,
    title: 'Câu 6',
    type: 'WRITING_EMAIL',
    description: null,
    practiceTopic: null,
    questions: [{ id: 240, content: { prompt: 'Reply to the e-mail.' } }],
  },
  ...over,
});

function setup() {
  const claim = jest.fn().mockResolvedValue({ count: 1 });
  const prisma: any = {
    submission: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: claim,
    },
    result: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    learningActivity: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    userQuizReward: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run(prisma)),
  };
  const ai = {
    evaluateWritingPart2: jest.fn().mockResolvedValue({
      score: 3,
      feedback: 'Bài viết trả lời đúng yêu cầu của e-mail.',
      suggestions: [],
    }),
  };
  const events = { emit: jest.fn() };
  const service = new WritingService(
    prisma,
    ai as any,
    undefined,
    events as any,
  );
  return { prisma, ai, events, service, claim };
}

describe('exam Writing grading after the section closes', () => {
  it('writes the grade onto the stored answer and rewards it once', async () => {
    const { prisma, service, claim, events } = setup();
    prisma.submission.findUnique.mockResolvedValue(stored());

    await service.gradeExamSubmissions([70]);

    expect(claim).toHaveBeenCalledWith({
      where: { id: 70, score: null },
      data: expect.objectContaining({ score: 3 }),
    });
    expect(prisma.result.updateMany).toHaveBeenCalledWith({
      where: { submissionId: 70 },
      data: { score: 3 },
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('adds no reward when another pass stored the grade first', async () => {
    const { prisma, service, claim, events } = setup();
    prisma.submission.findUnique.mockResolvedValue(stored());
    claim.mockResolvedValue({ count: 0 });

    await service.gradeExamSubmissions([70]);

    expect(prisma.learningActivity.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('skips an answer that already has a grade, without calling the provider', async () => {
    const { prisma, ai, service } = setup();
    prisma.submission.findUnique.mockResolvedValue(stored({ score: 2 }));

    await service.gradeExamSubmissions([70]);

    expect(ai.evaluateWritingPart2).not.toHaveBeenCalled();
  });

  it('keeps the answer and counts the try when the provider fails', async () => {
    const { prisma, ai, service, claim } = setup();
    prisma.submission.findUnique.mockResolvedValue(
      stored({ aiFeedback: JSON.stringify({ gradingTries: 1 }) }),
    );
    ai.evaluateWritingPart2.mockRejectedValue(new Error('provider down'));

    await expect(service.gradeExamSubmissions([70])).resolves.toBeUndefined();

    expect(claim).toHaveBeenCalledWith({
      where: { id: 70, score: null },
      data: { aiFeedback: JSON.stringify({ gradingTries: 2 }) },
    });
  });

  it('retries only answers that have not been given up on', async () => {
    const { prisma, service } = setup();
    const now = new Date('2026-11-02T10:00:00Z');
    prisma.submission.findMany.mockResolvedValue([
      { id: 70, aiFeedback: null, submittedAt: now },
      {
        id: 71,
        aiFeedback: JSON.stringify({ gradingTries: EXAM_WRITING_MAX_TRIES }),
        submittedAt: now,
      },
    ]);
    prisma.submission.findUnique.mockResolvedValue(stored());

    await service.retryUngradedExamWriting(now);

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          score: null,
          assessmentLinks: { some: {} },
        }),
      }),
    );
    expect(prisma.submission.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.submission.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 70 } }),
    );
  });

  it('gives up after the tries run out or a day has passed', () => {
    const now = new Date('2026-11-02T10:00:00Z');
    const fresh = { aiFeedback: null, submittedAt: now };
    expect(examWritingGaveUp(fresh, now)).toBe(false);
    expect(
      examWritingGaveUp(
        {
          aiFeedback: null,
          submittedAt: new Date(now.getTime() - EXAM_WRITING_GIVE_UP_AFTER_MS),
        },
        now,
      ),
    ).toBe(true);
    expect(
      examWritingGaveUp(
        {
          aiFeedback: JSON.stringify({ gradingTries: EXAM_WRITING_MAX_TRIES }),
          submittedAt: now,
        },
        now,
      ),
    ).toBe(true);
    expect(examWritingTries('not json')).toBe(0);
  });
});
