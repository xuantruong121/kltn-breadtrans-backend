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
      findMany: jest.fn().mockResolvedValue([]),
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

    await expect(
      service.completeComponent(1, 20, 7, {}),
    ).resolves.toBeDefined();

    expect(tx.toeicAssessmentAttemptComponent.update).toHaveBeenCalled();
  });

  afterEach(() => jest.useRealTimers());

  it('sums the sections into one exam clock: Speaking 20 + Writing 60 = 80 minutes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-02T08:05:00Z'));
    const { service } = setup([speaking(), writing()], 'SPEAKING', 20);
    const attempt = await service.getAttempt(1, 7);

    expect(attempt.totalLimitSeconds).toBe(4800);
    // 15 minutes left of Speaking, all 60 of Writing.
    expect(attempt.totalRemainingSeconds).toBe(15 * 60 + 3600);
  });

  it('does not store written answers sent after the section ran out', async () => {
    // Writing opened at 08:00 has 60 minutes plus a 30-second margin.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-02T09:01:00Z'));
    const { service, tx } = setup(
      [
        speaking({ status: 'COMPLETED' }),
        writing({ status: 'IN_PROGRESS', startedAt: STARTED }),
      ],
      'WRITING',
      21,
    );
    tx.submission.findMany.mockResolvedValue([]);

    await service.completeComponent(1, 21, 7, {
      writingAnswers: [{ quizId: 40, text: 'Too late' }],
    });

    expect(tx.submission.upsert).not.toHaveBeenCalled();
    expect(tx.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submittedAt: {
            gte: STARTED,
            lte: new Date('2026-11-02T09:00:30Z'),
          },
        }),
      }),
    );
  });

  it('stores written answers before grading, skipping blank and foreign tasks', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-02T08:30:00Z'));
    const { service, tx, writingService } = setup(
      [
        speaking({ status: 'COMPLETED' }),
        writing({ status: 'IN_PROGRESS', startedAt: STARTED }),
      ],
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
    expect(tx.toeicAssessmentWritingSubmission.createMany).toHaveBeenCalledWith(
      {
        data: [{ attemptComponentId: 11, submissionId: 70 }],
        skipDuplicates: true,
      },
    );
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

describe('TOEIC assessment sessions', () => {
  const fiveMinutesAgo = () => new Date(Date.now() - 5 * 60 * 1000);
  const openSession = (id: number, startedAt: Date) => ({
    id,
    startedAt,
    components: [
      {
        status: 'IN_PROGRESS',
        startedAt,
        assessmentComponent: { kind: 'SPEAKING' },
      },
    ],
  });

  it('opens a new session on Start and leaves the unfinished one alone', async () => {
    const { service, db, tx } = setup([speaking()], 'SPEAKING', 20);
    jest
      .spyOn(service as any, 'getPublishedAssessment')
      .mockResolvedValue({ components: [{ id: 20 }] });
    jest
      .spyOn(service as any, 'assertLearnerEntitlements')
      .mockResolvedValue(undefined);
    tx.$executeRaw = jest.fn().mockResolvedValue(1);
    tx.toeicAssessmentAttempt.findFirst = jest
      .fn()
      .mockResolvedValue({ id: 1, status: 'IN_PROGRESS' });
    tx.toeicAssessmentAttempt.create = jest.fn().mockResolvedValue({ id: 2 });

    await service.startAttempt(8, 7);

    expect(tx.toeicAssessmentAttempt.create).toHaveBeenCalledTimes(1);
    expect(tx.toeicAssessmentAttempt.update).not.toHaveBeenCalled();
    expect(db.toeicAssessmentAttempt.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 } }),
    );
  });

  it('one press sent twice opens one session', async () => {
    const { service, tx } = setup([speaking()], 'SPEAKING', 20);
    jest
      .spyOn(service as any, 'getPublishedAssessment')
      .mockResolvedValue({ components: [{ id: 20 }] });
    jest
      .spyOn(service as any, 'assertLearnerEntitlements')
      .mockResolvedValue(undefined);
    tx.$executeRaw = jest.fn().mockResolvedValue(1);
    tx.toeicAssessmentAttempt.findFirst = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    tx.toeicAssessmentAttempt.create = jest.fn();

    await service.startAttempt(8, 7, 'press-1');

    expect(tx.toeicAssessmentAttempt.create).not.toHaveBeenCalled();
  });

  it('offers the newest unfinished session that still has time', async () => {
    const { service, db } = setup([speaking()], 'SPEAKING', 20);
    const expired = openSession(5, new Date(Date.now() - 21 * 60 * 1000));
    const live = openSession(4, fiveMinutesAgo());
    db.toeicAssessmentAttempt.findMany.mockResolvedValue([expired, live]);

    const attempt = await service.getAttempt(1, 7);

    expect(attempt.previousSession?.id).toBe(4);
    expect(attempt.previousSession?.sectionKind).toBe('SPEAKING');
  });

  it('offers nothing once every other session ran out', async () => {
    const { service, db } = setup([speaking()], 'SPEAKING', 20);
    db.toeicAssessmentAttempt.findMany.mockResolvedValue([
      openSession(5, new Date(Date.now() - 21 * 60 * 1000)),
    ]);

    expect((await service.getAttempt(1, 7)).previousSession).toBeNull();
  });

  it('leaves a run-out session out of the history', async () => {
    const { service, db } = setup([speaking()], 'SPEAKING', 20);
    const old = new Date(Date.now() - 21 * 60 * 1000);
    db.toeicAssessmentAttempt.findMany.mockResolvedValue([
      attemptRow([speaking({ startedAt: old })]),
      { ...attemptRow([speaking({ startedAt: new Date() })]), id: 2 },
      {
        ...attemptRow([speaking({ startedAt: old, status: 'COMPLETED' })]),
        id: 3,
        status: 'COMPLETED',
      },
    ]);

    const history = await service.history(7);

    expect(history.map((attempt) => attempt.id)).toEqual([2, 3]);
  });
});
