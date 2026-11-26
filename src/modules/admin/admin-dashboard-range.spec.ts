import {
  buildDashboardBuckets,
  normalizeDashboardRange,
  previousDashboardStart,
} from './admin-dashboard.logic';

// Instants carry their offset, so the expectations hold on any server timezone.
describe('dashboard range helpers', () => {
  // 21/10/2026 12:00 in Vietnam.
  const now = new Date('2026-10-21T12:00:00+07:00');

  it('opens on the 30-day view for an absent or unsupported range', () => {
    expect(normalizeDashboardRange()).toBe('30d');
    expect(normalizeDashboardRange('unsupported')).toBe('30d');
    expect(normalizeDashboardRange('6m')).toBe('6m');
  });

  it('builds one complete Vietnam calendar day for each of the last 30 days', () => {
    const buckets = buildDashboardBuckets('30d', now);

    expect(buckets).toHaveLength(30);
    expect(buckets[0].label).toBe('22/9');
    expect(buckets[0].start).toEqual(new Date('2026-09-22T00:00:00+07:00'));
    expect(buckets.at(-1)?.label).toBe('21/10');
    expect(buckets.at(-1)?.end).toEqual(
      new Date('2026-10-21T23:59:59.999+07:00'),
    );
  });

  it('puts 00:00 to 07:00 Vietnam time in that Vietnam day, not the day before', () => {
    // 22/10 06:30 in Vietnam is still 21/10 in UTC.
    const early = new Date('2026-10-22T06:30:00+07:00');
    const buckets = buildDashboardBuckets('30d', early);

    expect(buckets.at(-1)?.label).toBe('22/10');
    expect(buckets.at(-1)?.start).toEqual(
      new Date('2026-10-22T00:00:00+07:00'),
    );
  });

  it('builds six or twelve complete month buckets in chronological order', () => {
    const sixMonths = buildDashboardBuckets('6m', now);
    const twelveMonths = buildDashboardBuckets('12m', now);

    expect(sixMonths).toHaveLength(6);
    expect(sixMonths[0].label).toBe('T5');
    expect(sixMonths[0].start).toEqual(new Date('2026-05-01T00:00:00+07:00'));
    expect(sixMonths.at(-1)?.label).toBe('T10');
    expect(sixMonths.at(-1)?.end).toEqual(
      new Date('2026-10-31T23:59:59.999+07:00'),
    );
    expect(twelveMonths).toHaveLength(12);
    expect(twelveMonths[0].label).toBe('T11');
    expect(twelveMonths[0].start).toEqual(
      new Date('2025-11-01T00:00:00+07:00'),
    );
    expect(twelveMonths.at(-1)?.label).toBe('T10');
  });

  it('starts the period before as long before as the chosen one lasts', () => {
    expect(previousDashboardStart('30d', now)).toEqual(
      new Date('2026-08-23T00:00:00+07:00'),
    );
    expect(previousDashboardStart('6m', now)).toEqual(
      new Date('2025-11-01T00:00:00+07:00'),
    );
    expect(previousDashboardStart('12m', now)).toEqual(
      new Date('2024-11-01T00:00:00+07:00'),
    );
  });
});

describe('getDashboardStats figures (owner 2026-11-26)', () => {
  const count = (value: number) => jest.fn().mockResolvedValue(value);
  const prisma = () => ({
    user: { count: count(6) },
    planPayment: {
      count: count(1),
      findFirst: jest.fn().mockResolvedValue({
        createdAt: new Date('2026-11-20T08:00:00Z'),
        reportedAt: new Date('2026-11-21T08:00:00Z'),
      }),
    },
    vocabTopic: { count: count(30) },
    grammarTopic: { count: count(12) },
    quiz: { count: count(24) },
    speakingPracticeSet: { count: count(21) },
    exam: { count: count(3) },
    contentTopic: { count: count(2) },
    marketOrder: {
      count: count(3),
      findFirst: jest
        .fn()
        .mockResolvedValue({ createdAt: new Date('2026-11-22T08:00:00Z') }),
    },
    userStats: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalBanhRan: 330 } }),
    },
    supportMessage: {
      count: count(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    suggestion: {
      count: count(1),
      findFirst: jest
        .fn()
        .mockResolvedValue({ createdAt: new Date('2026-11-10T08:00:00Z') }),
    },
    issueReport: {
      count: count(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    planPurchase: {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({
          _sum: { amountVnd: 69000 },
          _count: { id: 1 },
        })
        .mockResolvedValueOnce({ _sum: { amountVnd: null }, _count: { id: 0 } })
        .mockResolvedValue({ _sum: { amountVnd: 0 }, _count: { id: 0 } }),
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

  const userWheres = (db: ReturnType<typeof prisma>) =>
    db.user.count.mock.calls.map((call: any[]) => call[0]?.where);

  it('counts as active only learners who learned, never a sign-in alone', async () => {
    const db = prisma();
    await build(db).getDashboardStats('30d');
    const active = userWheres(db).filter((where: any) => where?.OR);
    expect(active).toHaveLength(2);
    for (const where of active) {
      expect(JSON.stringify(where)).not.toContain('lastLoginAt');
      expect(where.OR).toHaveLength(7);
    }
    // This period from its start; the period before up to that start.
    const [current, previous] = active.map(
      (where: any) => where.OR[0].learningActivities.some.occurredAt,
    );
    expect(current.lt).toBeUndefined();
    expect(previous.lt).toEqual(current.gte);
    expect(previous.gte.getTime()).toBeLessThan(current.gte.getTime());
  });

  it('reports the period before beside revenue, purchases, active and new learners', async () => {
    const stats = await build(prisma()).getDashboardStats('30d');
    expect(stats.finance.totalRevenueVnd).toBe(69000);
    expect(stats.finance.previous).toEqual({
      totalRevenueVnd: 0,
      completedPurchasesCount: 0,
    });
    expect(stats.stats.previous).toEqual({ activeStudents: 6, newStudents: 6 });
    expect(stats.stats.newStudents).toBe(6);
    expect(stats.stats.newStudentsWithDiagnostic).toBe(6);
  });

  it('counts new learners who completed the entry assessment, no level or score', async () => {
    const db = prisma();
    await build(db).getDashboardStats('30d');
    const withDiagnostic = userWheres(db).find(
      (where: any) => where?.diagnosticAttempts,
    );
    expect(withDiagnostic.createdAt.gte).toBeInstanceOf(Date);
    expect(withDiagnostic.diagnosticAttempts).toEqual({
      some: { status: 'COMPLETED' },
    });
  });

  it('counts paid plans ending within 7 days with nothing paid after them', async () => {
    const db = prisma();
    await build(db).getDashboardStats('30d');
    const ending = userWheres(db).find((where: any) => where?.subscriptions);
    const { some, none } = ending.subscriptions;
    expect(ending).toMatchObject({
      role: 'STUDENT',
      deletionRequestedAt: null,
      anonymizedAt: null,
    });
    expect(some.planVersion).toEqual({ plan: { code: { not: 'FREE' } } });
    expect(some.endsAt.lte.getTime() - some.endsAt.gt.getTime()).toBe(
      7 * 86_400_000,
    );
    expect(none.endsAt.gt).toEqual(some.endsAt.lte);
    expect(none.planVersion).toEqual(some.planVersion);
  });

  it('gives how long the oldest item of each waiting row has waited', async () => {
    const stats = await build(prisma()).getDashboardStats('30d');
    expect(stats.waitingSince).toEqual({
      // A payment waits from when the learner reported the transfer.
      pendingPayments: new Date('2026-11-21T08:00:00Z'),
      pendingOrders: new Date('2026-11-22T08:00:00Z'),
      openIssueReports: null,
      unreadSupportMessages: null,
      pendingSuggestions: new Date('2026-11-10T08:00:00Z'),
    });
  });
});
