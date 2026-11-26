import { LearningSummaryService } from './learning-summary.service';

const now = new Date('2026-11-26T15:30:00+07:00');

function prisma(over: Record<string, any> = {}) {
  return {
    studyTime: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { seconds: 0 } }),
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([
        { dayKey: '2026-11-25', skill: 'LISTENING', seconds: 600 },
        { dayKey: '2026-11-26', skill: 'GRAMMAR', seconds: 120 },
      ]),
    },
    submission: {
      findMany: jest.fn().mockResolvedValue([
        {
          submittedAt: new Date('2026-11-25T09:00:00+07:00'),
          quiz: { type: 'LISTENING_PRACTICE' },
        },
        {
          submittedAt: new Date('2026-11-24T09:00:00+07:00'),
          quiz: { type: 'WRITING_PICTURE' },
        },
      ]),
    },
    speakingSubmission: { findMany: jest.fn().mockResolvedValue([]) },
    toeicAttempt: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { submittedAt: new Date('2026-11-23T09:00:00+07:00') },
        ]),
    },
    learningActivity: {
      findMany: jest.fn().mockResolvedValue([
        { occurredAt: new Date('2026-11-24T09:00:00+07:00'), sourceId: '1' },
        { occurredAt: new Date('2026-11-25T09:00:00+07:00'), sourceId: '1' },
        { occurredAt: new Date('2026-11-25T09:00:00+07:00'), sourceId: '9' },
      ]),
    },
    pointHistory: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { points: 40 } }),
    },
    grammarAttempt: {
      findMany: jest.fn().mockResolvedValue([{ answers: [1, 2] }]),
    },
    contentAttempt: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalCount: 3 } }),
    },
    result: { count: jest.fn().mockResolvedValue(10) },
    toeicAttemptAnswer: { count: jest.fn().mockResolvedValue(5) },
    userVocabWordProgress: {
      findMany: jest.fn().mockResolvedValue([{ wordId: 1 }, { wordId: 2 }]),
    },
    leaderboard: {
      findUnique: jest.fn().mockResolvedValue({ totalPoints: 1505 }),
    },
    ...over,
  };
}

describe('LearningSummaryService.summary (owner 2026-11-26: real figures per period)', () => {
  it('sums the week from the learner rows', async () => {
    const db = prisma();
    const r = await new LearningSummaryService(db as any).summary(
      1,
      'week',
      undefined,
      undefined,
      now,
    );
    expect(r).toMatchObject({
      period: 'week',
      from: '2026-11-23',
      to: '2026-11-26',
      days: 4,
    });
    expect(r.totals).toEqual({
      studySeconds: 720,
      questions: 10 + 5 + 3 + 2,
      // word 9 was mastered then lost: not counted; word 1 once
      vocabMastered: 1,
      xp: 40,
    });
    expect(r.skills.LISTENING).toEqual({ count: 1, seconds: 600, days: 1 });
    expect(r.skills.WRITING).toEqual({ count: 1, seconds: 0, days: 1 });
    expect(r.skills.EXAM.count).toBe(1);
    expect(r.skills.VOCAB).toEqual({ count: 1, seconds: 0, days: 1 });
    // XP from PointHistory, gains only, from Monday 00:01
    const xpWhere = db.pointHistory.aggregate.mock.calls[0][0].where;
    expect(xpWhere.points).toEqual({ gt: 0 });
    expect(xpWhere.createdAt.gte).toEqual(
      new Date('2026-11-23T00:01:00+07:00'),
    );
    expect(db.leaderboard.findUnique).not.toHaveBeenCalled();
  });

  it('over every period shows the totals the rest of the app shows', async () => {
    const db = prisma();
    const r = await new LearningSummaryService(db as any).summary(
      1,
      'all',
      undefined,
      undefined,
      now,
    );
    expect(r.totals.xp).toBe(1505);
    expect(r.totals.vocabMastered).toBe(2);
    expect(r.skills.VOCAB.count).toBe(2);
    expect(r.days).toBeNull();
    expect(db.studyTime.findMany.mock.calls[0][0].where.dayKey).toEqual({
      lte: '2026-11-26',
    });
  });
});

describe('LearningSummaryService.addStudyTime', () => {
  it('adds the report to the learner day and skill', async () => {
    const db = prisma();
    const r = await new LearningSummaryService(db as any).addStudyTime(
      1,
      'READING',
      60,
      now,
    );
    expect(r).toEqual({ dayKey: '2026-11-26', added: 60 });
    expect(db.studyTime.upsert).toHaveBeenCalledWith({
      where: {
        userId_dayKey_skill: {
          userId: 1,
          dayKey: '2026-11-26',
          skill: 'READING',
        },
      },
      create: {
        userId: 1,
        dayKey: '2026-11-26',
        skill: 'READING',
        seconds: 60,
      },
      update: { seconds: { increment: 60 } },
    });
  });

  it('writes nothing once the day holds twelve hours', async () => {
    const db = prisma({
      studyTime: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { seconds: 12 * 3600 } }),
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
    });
    const r = await new LearningSummaryService(db as any).addStudyTime(
      1,
      'READING',
      60,
      now,
    );
    expect(r.added).toBe(0);
    expect(db.studyTime.upsert).not.toHaveBeenCalled();
  });
});
