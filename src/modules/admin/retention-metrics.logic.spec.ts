import {
  cohortRetention,
  latest,
  renewalByWeek,
  vnDayIndex,
  vnWeekStart,
} from './retention-metrics.logic';

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe('vnWeekStart', () => {
  it('starts weeks on Monday in Vietnam time', () => {
    // 2026-11-04 is a Wednesday.
    expect(vnWeekStart(at('2026-11-04T10:00:00+07:00'))).toBe('2026-11-02');
    expect(vnWeekStart(at('2026-11-02T00:00:00+07:00'))).toBe('2026-11-02');
    expect(vnWeekStart(at('2026-11-08T23:59:00+07:00'))).toBe('2026-11-02');
  });

  it('uses the Vietnam day, not the UTC day', () => {
    // 2026-11-01 18:00 UTC is Monday 2026-11-02 01:00 in Vietnam.
    expect(vnWeekStart(at('2026-11-01T18:00:00Z'))).toBe('2026-11-02');
    expect(vnDayIndex(at('2026-11-01T18:00:00Z'))).toBe(
      vnDayIndex(at('2026-11-02T12:00:00+07:00')),
    );
  });
});

describe('cohortRetention', () => {
  const signup = at('2026-10-05T09:00:00+07:00'); // Monday
  const now = at('2026-11-04T09:00:00+07:00'); // day 30 after signup

  it('counts a learner retained at day N when the last learning day is N or later', () => {
    const rows = cohortRetention({
      learners: [
        { id: 1, createdAt: signup },
        { id: 2, createdAt: signup },
        { id: 3, createdAt: signup },
      ],
      lastActiveAt: new Map([
        [1, new Date(signup.getTime() + 1 * DAY)],
        [2, new Date(signup.getTime() + 30 * DAY)],
      ]),
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].weekStart).toBe('2026-10-05');
    expect(rows[0].signups).toBe(3);
    expect(rows[0].d1).toEqual({ eligible: 3, hits: 2, rate: 2 / 3 });
    expect(rows[0].d7).toEqual({ eligible: 3, hits: 1, rate: 1 / 3 });
    expect(rows[0].d30).toEqual({ eligible: 3, hits: 1, rate: 1 / 3 });
  });

  it('leaves day N out until day N has arrived', () => {
    const recent = at('2026-11-01T09:00:00+07:00');
    const [row] = cohortRetention({
      learners: [{ id: 1, createdAt: recent }],
      lastActiveAt: new Map([[1, now]]),
      now,
    });
    expect(row.d1).toEqual({ eligible: 1, hits: 1, rate: 1 });
    expect(row.d7).toEqual({ eligible: 0, hits: 0, rate: null });
    expect(row.d30.rate).toBeNull();
  });

  it('does not count learning on the signup day itself', () => {
    const [row] = cohortRetention({
      learners: [{ id: 1, createdAt: signup }],
      lastActiveAt: new Map([[1, at('2026-10-05T22:00:00+07:00')]]),
      now,
    });
    expect(row.d1.hits).toBe(0);
  });

  it('sorts the newest week first', () => {
    const rows = cohortRetention({
      learners: [
        { id: 1, createdAt: signup },
        { id: 2, createdAt: at('2026-10-20T09:00:00+07:00') },
      ],
      lastActiveAt: new Map(),
      now,
    });
    expect(rows.map((r) => r.weekStart)).toEqual(['2026-10-19', '2026-10-05']);
  });
});

describe('renewalByWeek', () => {
  const endsAt = at('2026-10-06T10:00:00+07:00');
  const sub = {
    userId: 7,
    endsAt,
    purchaseId: 100,
    purchasedAt: new Date(endsAt.getTime() - 30 * DAY),
  };
  const now = at('2026-11-20T10:00:00+07:00'); // past day +30

  const run = (
    purchases: Array<{ id: number; completedAt: Date; withCode?: boolean }>,
  ) =>
    renewalByWeek({
      ended: [sub],
      purchases: [
        { id: 100, userId: 7, completedAt: sub.purchasedAt },
        ...purchases.map((p) => ({ ...p, userId: 7 })),
      ],
      now,
    })[0];

  it('counts a renewal bought before the end as early and renewed', () => {
    const row = run([
      { id: 101, completedAt: new Date(endsAt.getTime() - 20 * DAY) },
    ]);
    expect(row.ended).toBe(1);
    expect(row.early.hits).toBe(1);
    expect(row.renewed.hits).toBe(1);
    expect(row.wonBack.eligible).toBe(0);
  });

  it('counts an upgrade that ends the plan at the purchase moment as early', () => {
    const row = run([{ id: 101, completedAt: endsAt }]);
    expect(row.early.hits).toBe(1);
  });

  it('counts a purchase within 7 days after the end as renewed, not early', () => {
    const row = run([
      { id: 101, completedAt: new Date(endsAt.getTime() + 5 * DAY) },
    ]);
    expect(row.early.hits).toBe(0);
    expect(row.renewed.hits).toBe(1);
  });

  it('counts a purchase between day +7 and day +30 as won back', () => {
    const row = run([
      { id: 101, completedAt: new Date(endsAt.getTime() + 12 * DAY) },
    ]);
    expect(row.renewed).toEqual({ eligible: 1, hits: 0, rate: 0 });
    expect(row.wonBack).toEqual({ eligible: 1, hits: 1, rate: 1 });
    expect(row.wonBackWithCode).toBe(0);
  });

  it('counts a win-back paid with a promo code', () => {
    const row = run([
      {
        id: 101,
        completedAt: new Date(endsAt.getTime() + 10 * DAY),
        withCode: true,
      },
    ]);
    expect(row.wonBack.hits).toBe(1);
    expect(row.wonBackWithCode).toBe(1);
  });

  it('never counts the subscription own purchase as the next one', () => {
    const row = run([]);
    expect(row.early.hits).toBe(0);
    expect(row.renewed.hits).toBe(0);
    expect(row.wonBack).toEqual({ eligible: 1, hits: 0, rate: 0 });
  });

  it('keeps renewal and win-back out until their window has closed', () => {
    const [row] = renewalByWeek({
      ended: [sub],
      purchases: [],
      now: new Date(endsAt.getTime() + 3 * DAY),
    });
    expect(row.early.eligible).toBe(1);
    expect(row.renewed.eligible).toBe(0);
    expect(row.wonBack.eligible).toBe(0);
  });

  it('skips subscriptions that have not ended yet', () => {
    expect(
      renewalByWeek({
        ended: [sub],
        purchases: [],
        now: new Date(endsAt.getTime() - DAY),
      }),
    ).toEqual([]);
  });
});

describe('latest', () => {
  it('returns the latest date and ignores missing ones', () => {
    expect(latest(null, at('2026-01-02'), undefined, at('2026-01-01'))).toEqual(
      at('2026-01-02'),
    );
    expect(latest(null, undefined)).toBeNull();
  });
});
