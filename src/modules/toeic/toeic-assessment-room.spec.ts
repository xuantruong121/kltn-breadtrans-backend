import { ConflictException } from '@nestjs/common';
import { ToeicAssessmentService } from './toeic-assessment.service';

const STARTED = new Date('2026-11-02T08:00:00Z');

function attemptRow(components: unknown[]) {
  return {
    id: 1,
    userId: 7,
    assessmentId: 8,
    status: 'IN_PROGRESS',
    startedAt: STARTED,
    submittedAt: null,
    completedAt: null,
    assessment: {
      id: 8,
      title: 'S&W',
      productFamily: 'TOEIC_SW',
      components: [
        {
          id: 20,
          speakingPracticeSetId: 'set',
          speakingPracticeSet: { exercises: [{ id: 101 }, { id: 102 }] },
        },
        {
          id: 21,
          writingSetId: 3,
          writingSet: { items: [{ writingQuizId: 40 }, { writingQuizId: 41 }] },
        },
      ],
    },
    components,
  };
}

const speaking = (over: Record<string, unknown> = {}) => ({
  id: 10,
  assessmentComponentId: 20,
  status: 'IN_PROGRESS',
  startedAt: STARTED,
  assessmentComponent: { kind: 'SPEAKING', order: 1 },
  speakingSubmissions: [],
  writingSubmissions: [],
  ...over,
});

const writing = (over: Record<string, unknown> = {}) => ({
  id: 11,
  assessmentComponentId: 21,
  status: 'NOT_STARTED',
  startedAt: null,
  assessmentComponent: { kind: 'WRITING', order: 2 },
  speakingSubmissions: [],
  writingSubmissions: [],
  ...over,
});

function setup(components: unknown[], kind: string, componentId: number) {
  const tx: any = {
    speakingSubmission: { findMany: jest.fn().mockResolvedValue([]) },
    toeicAssessmentSpeakingSubmission: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    toeicAssessmentWritingSubmission: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    toeicWritingSet: {
      findUnique: jest.fn().mockResolvedValue({
        items: [
          {
            writingQuizId: 40,
            writingQuiz: { questions: [{ id: 240 }] },
          },
          {
            writingQuizId: 41,
            writingQuiz: { questions: [{ id: 241 }] },
          },
        ],
      }),
    },
    submission: {
      upsert: jest.fn().mockResolvedValue({ id: 70 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    toeicAssessmentAttemptComponent: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    toeicAssessmentAttempt: { update: jest.fn() },
  };
  const db: any = {
    ...tx,
    toeicAssessmentAttempt: {
      findUnique: jest.fn().mockResolvedValue(attemptRow(components)),
    },
    toeicAssessmentComponent: {
      findUnique: jest.fn().mockResolvedValue({
        id: componentId,
        kind,
        order: kind === 'SPEAKING' ? 1 : 2,
        speakingPracticeSetId: 'set',
        writingSetId: 3,
      }),
    },
    $transaction: jest.fn((run: (client: unknown) => unknown) => run(tx)),
  };
  const writingService = {
    gradeExamSubmissions: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ToeicAssessmentService(
    db,
    {} as any,
    writingService as any,
  );
  return { tx, db, service, writingService };
}

describe('TOEIC assessment exam room', () => {
  it('gives a timed section a deadline from when it started, and no earlier', async () => {
    const { service } = setup([speaking(), writing()], 'SPEAKING', 20);
    const attempt = await service.getAttempt(1, 7);

    expect(attempt.components[0]).toMatchObject({
      timeLimitSeconds: 1200,
      deadlineAt: new Date('2026-11-02T08:20:00Z'),
    });
    expect(attempt.components[1]).toMatchObject({
      timeLimitSeconds: 3600,
      deadlineAt: null,
    });
  });

  it('counts the recordings kept for each task while the section is open', async () => {
    const { service, db } = setup([speaking(), writing()], 'SPEAKING', 20);
    db.speakingSubmission.findMany.mockResolvedValue([
      { exerciseId: 101 },
      { exerciseId: 101 },
    ]);

    const attempt = await service.getAttempt(1, 7);

    expect(attempt.components[0].speakingTakes).toEqual([
      { exerciseId: 101, takes: 2 },
    ]);
    expect(db.speakingSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'FAILED' } }),
      }),
    );
  });

  it('closes Speaking with tasks missing and links the newest take of each', async () => {
    const { service, tx } = setup([speaking(), writing()], 'SPEAKING', 20);
    tx.speakingSubmission.findMany.mockResolvedValue([
      { id: 9, exerciseId: 101 },
      { id: 8, exerciseId: 101 },
    ]);

    await service.completeComponent(1, 20, 7, {});

    expect(
      tx.toeicAssessmentSpeakingSubmission.createMany,
    ).toHaveBeenCalledWith({
      data: [{ attemptComponentId: 10, speakingSubmissionId: 9 }],
      skipDuplicates: true,
    });
    expect(tx.toeicAssessmentAttemptComponent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('closes Speaking with nothing recorded, so the clock can always end it', async () => {
    const { service, tx } = setup([speaking(), writing()], 'SPEAKING', 20);

    await expect(service.completeComponent(1, 20, 7, {})).resolves.toBeDefined();

    expect(tx.toeicAssessmentAttemptComponent.update).toHaveBeenCalled();
  });

  it('stores written answers before grading, skipping blank and foreign tasks', async () => {
    const { service, tx, writingService } = setup(
      [speaking({ status: 'COMPLETED' }), writing({ status: 'IN_PROGRESS', startedAt: STARTED })],
      'WRITING',
      21,
    );
    tx.submission.findMany.mockResolvedValue([
      { id: 70, quizId: 40, score: null, results: [] },
    ]);

    await service.completeComponent(1, 21, 7, {
      writingAnswers: [
        { quizId: 40, text: '  Dear team  ' },
        { quizId: 41, text: '   ' },
        { quizId: 999, text: 'Not part of this exam' },
      ],
    });

    expect(tx.submission.upsert).toHaveBeenCalledTimes(1);
    expect(tx.submission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          userId: 7,
          quizId: 40,
          clientAttemptId: 'assessment-11-40',
          results: { create: [{ questionId: 240, answer: 'Dear team' }] },
        },
      }),
    );
    expect(tx.toeicAssessmentWritingSubmission.createMany).toHaveBeenCalledWith({
      data: [{ attemptComponentId: 11, submissionId: 70 }],
      skipDuplicates: true,
    });
    expect(writingService.gradeExamSubmissions).toHaveBeenCalledWith([70]);
  });

  it('keeps a key short enough for the column', () => {
    expect('assessment-2147483647-2147483647'.length).toBeLessThanOrEqual(36);
  });

  it('a section already closed answers the same, storing nothing again', async () => {
    const { service, tx } = setup(
      [speaking({ status: 'COMPLETED' }), writing({ status: 'COMPLETED' })],
      'WRITING',
      21,
    );

    await service.completeComponent(1, 21, 7, {
      writingAnswers: [{ quizId: 40, text: 'Dear team' }],
    });

    expect(tx.submission.upsert).not.toHaveBeenCalled();
  });

  it('opens a section only after the ones before it', async () => {
    const { service, db } = setup([speaking(), writing()], 'WRITING', 21);
    db.toeicAssessment = { findUnique: jest.fn() };

    await expect(service.startComponent(1, 21, 7)).rejects.toThrow(
      ConflictException,
    );
  });
});
