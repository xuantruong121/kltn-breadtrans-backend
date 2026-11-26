import {
  buildDashboardBuckets,
  normalizeDashboardRange,
} from './admin.service';

describe('dashboard range helpers', () => {
  const now = new Date(2026, 9, 21, 12, 0, 0);

  it('uses the established six-month view for an absent or unsupported range', () => {
    expect(normalizeDashboardRange()).toBe('6m');
    expect(normalizeDashboardRange('unsupported')).toBe('6m');
  });

  it('builds one complete bucket for each of the last 30 days', () => {
    const buckets = buildDashboardBuckets('30d', now);

    expect(buckets).toHaveLength(30);
    expect(buckets[0].start).toEqual(new Date(2026, 8, 22, 0, 0, 0, 0));
    expect(buckets.at(-1)?.end).toEqual(new Date(2026, 9, 21, 23, 59, 59, 999));
  });

  it('builds six or twelve complete month buckets in chronological order', () => {
    const sixMonths = buildDashboardBuckets('6m', now);
    const twelveMonths = buildDashboardBuckets('12m', now);

    expect(sixMonths).toHaveLength(6);
    expect(sixMonths[0].label).toBe('T5');
    expect(sixMonths.at(-1)?.label).toBe('T10');
    expect(twelveMonths).toHaveLength(12);
    expect(twelveMonths[0].label).toBe('T11');
    expect(twelveMonths.at(-1)?.label).toBe('T10');
  });
});

describe('getDashboardStats figures (owner 2026-11-26)', () => {
  const count = (value: number) => jest.fn().mockResolvedValue(value);
  const prisma = () => ({
    user: { count: count(6) },
    planPayment: { count: count(0) },
    vocabTopic: { count: count(30) },
    grammarTopic: { count: count(12) },
    quiz: { count: count(24) },
    speakingPracticeSet: { count: count(21) },
    exam: { count: count(3) },
    contentTopic: { count: count(2) },
    marketOrder: { count: count(3) },
    userStats: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalBanhRan: 330 } }),
    },
    supportMessage: { count: count(0) },
    suggestion: { count: count(1) },
    issueReport: { count: count(0) },
    planPurchase: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { amountVnd: 69000 }, _count: { id: 1 } }),
    },
    subscription: { count: count(1) },
    submission: { count: count(5) },
    speakingSubmission: { count: count(1) },
    grammarAttempt: { count: count(2) },
    toeicAttempt: { count: count(1) },
    contentAttempt: { count: count(1) },
    diagnosticAttempt: { count: count(1) },
  });
  const build = (db: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    new (require('./admin.service').AdminService)(db, {}, {}, {}, undefined);

  it('takes revenue and gift orders from the chosen range, pending orders whenever placed', async () => {
    const db = prisma();
    await build(db).getDashboardStats('30d');
    const revenueWhere = db.planPurchase.aggregate.mock.calls[0][0].where;
    expect(revenueWhere.status).toBe('COMPLETED');
    expect(revenueWhere.completedAt.gte).toBeInstanceOf(Date);
    const orderWheres = db.marketOrder.count.mock.calls.map(
      (call: any[]) => call[0]?.where,
    );
    expect(orderWheres[0].createdAt.gte).toBeInstanceOf(Date);
    expect(orderWheres[1]).toMatchObject({ status: 'approved' });
    expect(orderWheres[1].createdAt.gte).toBeInstanceOf(Date);
    expect(orderWheres[2]).toEqual({ status: 'pending' });
  });

  it('counts every kind of attempt in the activity trend', async () => {
    const stats = await build(prisma()).getDashboardStats('6m');
    expect(stats.monthlyTrends).toHaveLength(6);
    // submissions 5 + speaking 1 + grammar 2 + TOEIC 1 + content 1 + diagnostic 1
    expect(stats.monthlyTrends[0].activityCount).toBe(11);
  });

  it('counts practice content per area, exams apart, Speaking sets of skill practice only', async () => {
    const db = prisma();
    const stats = await build(db).getDashboardStats('6m');
    expect(Object.keys(stats.contentBreakdown)).toEqual([
      'vocabDecks',
      'grammarTopics',
      'listeningLessons',
      'readingLessons',
      'writingLessons',
      'speakingSets',
      'exams',
      'mediaTopics',
    ]);
    const quizTypes = db.quiz.count.mock.calls.map(
      (call: any[]) => call[0].where.type,
    );
    expect(quizTypes).toEqual([
      'LISTENING_PRACTICE',
      'BILINGUAL_READING',
      { in: ['WRITING_EMAIL', 'WRITING_PICTURE'] },
    ]);
    expect(db.speakingPracticeSet.count.mock.calls[0][0].where).toEqual({
      scope: 'SKILL_PRACTICE',
    });
    expect(db.vocabTopic.count.mock.calls[0][0].where).toEqual({
      categoryName: { not: 'SYSTEM_DICTIONARY' },
    });
  });
});
