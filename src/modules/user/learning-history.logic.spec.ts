import {
  clampHistoryPage,
  lastDaysCounts,
  nextDayKey,
  planHistoryPages,
} from './learning-history.logic';

describe('planHistoryPages', () => {
  it('returns no page for no rows', () => {
    expect(planHistoryPages([])).toEqual([]);
    expect(planHistoryPages([{ dayKey: '2026-11-28', count: 0 }])).toEqual([]);
  });

  it('keeps one short history on one page', () => {
    expect(
      planHistoryPages([
        { dayKey: '2026-11-28', count: 3 },
        { dayKey: '2026-11-27', count: 4 },
      ]),
    ).toEqual([
      { newestDayKey: '2026-11-28', oldestDayKey: '2026-11-27', rows: 7 },
    ]);
  });

  it('never splits a day: a page closes only on a day edge, once it holds 20 rows', () => {
    const pages = planHistoryPages([
      { dayKey: '2026-11-28', count: 12 },
      { dayKey: '2026-11-27', count: 12 }, // 24 rows: page 1 closes here
      { dayKey: '2026-11-26', count: 5 },
      { dayKey: '2026-11-25', count: 30 }, // 35 rows: page 2 closes here
      { dayKey: '2026-11-24', count: 1 },
    ]);
    expect(pages).toEqual([
      { newestDayKey: '2026-11-28', oldestDayKey: '2026-11-27', rows: 24 },
      { newestDayKey: '2026-11-26', oldestDayKey: '2026-11-25', rows: 35 },
      { newestDayKey: '2026-11-24', oldestDayKey: '2026-11-24', rows: 1 },
    ]);
  });

  it('keeps a very heavy day whole, on its own page', () => {
    const pages = planHistoryPages([
      { dayKey: '2026-11-28', count: 400 },
      { dayKey: '2026-11-27', count: 2 },
    ]);
    expect(pages[0]).toEqual({
      newestDayKey: '2026-11-28',
      oldestDayKey: '2026-11-28',
      rows: 400,
    });
    expect(pages).toHaveLength(2);
  });

  it('sorts the days itself, newest first', () => {
    const pages = planHistoryPages(
      [
        { dayKey: '2026-11-20', count: 25 },
        { dayKey: '2026-11-28', count: 25 },
      ],
      20,
    );
    expect(pages.map((p) => p.newestDayKey)).toEqual([
      '2026-11-28',
      '2026-11-20',
    ]);
  });

  it('covers every row exactly once', () => {
    const list = Array.from({ length: 30 }, (_, i) => ({
      dayKey: `2026-10-${String(i + 1).padStart(2, '0')}`,
      count: (i % 7) + 1,
    }));
    const total = list.reduce((sum, d) => sum + d.count, 0);
    const pages = planHistoryPages(list, 15);
    expect(pages.reduce((sum, p) => sum + p.rows, 0)).toBe(total);
    // Pages follow one another without a gap or an overlap.
    for (let i = 1; i < pages.length; i += 1)
      expect(pages[i].newestDayKey < pages[i - 1].oldestDayKey).toBe(true);
  });
});

describe('clampHistoryPage', () => {
  it.each([
    [undefined, 5, 1],
    [NaN, 5, 1],
    [0, 5, 1],
    [-3, 5, 1],
    [2, 5, 2],
    [2.9, 5, 2],
    [9, 5, 5],
    [3, 0, 1],
  ])('page %p of %p is %p', (requested, pageCount, expected) => {
    expect(clampHistoryPage(requested, pageCount)).toBe(expected);
  });
});

describe('nextDayKey', () => {
  it('moves over a month and a year edge', () => {
    expect(nextDayKey('2026-11-28')).toBe('2026-11-29');
    expect(nextDayKey('2026-11-30')).toBe('2026-12-01');
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01');
  });
});

describe('lastDaysCounts', () => {
  it('lists the 7 learner days ending today, oldest first, with 0 for empty days', () => {
    const week = lastDaysCounts(
      [
        { dayKey: '2026-11-28', count: 60 }, // more than one page of rows: still counted whole
        { dayKey: '2026-11-25', count: 2 },
        { dayKey: '2026-11-01', count: 9 }, // outside the week
      ],
      '2026-11-28',
    );
    expect(week.map((d) => d.dayKey)).toEqual([
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
    ]);
    expect(week.map((d) => d.count)).toEqual([0, 0, 0, 2, 0, 0, 60]);
  });
});
