import {
  allowance,
  buildDailyUsage,
  nextBusinessDayStart,
} from './daily-usage';

describe('daily usage (owner 2026-11-13: "Gói của tôi" shows what is left)', () => {
  it('counts what was used, never past the limit or below zero', () => {
    expect(allowance(10, '3')).toEqual({ limit: 10, used: 3, remaining: 7 });
    expect(allowance(10, '12')).toEqual({ limit: 10, used: 10, remaining: 0 });
    expect(allowance(10, null)).toEqual({ limit: 10, used: 0, remaining: 10 });
    expect(allowance(10, 'x')).toEqual({ limit: 10, used: 0, remaining: 10 });
  });

  it('takes the limits from the plan', () => {
    const usage = buildDailyUsage(
      'PLUS',
      '5',
      '1',
      new Date('2026-11-13T10:00:00Z'),
    );
    expect(usage.aiGrading).toEqual({ limit: 30, used: 5, remaining: 25 });
    expect(usage.tutor).toEqual({ limit: 30, used: 1, remaining: 29 });
  });

  it('resets at 00:00 of the next Vietnam day', () => {
    // 23:30 on 13/11 in Vietnam is 16:30 UTC.
    expect(
      nextBusinessDayStart(new Date('2026-11-13T16:30:00Z')).toISOString(),
    ).toBe('2026-11-13T17:00:00.000Z');
    // 00:30 on 14/11 in Vietnam: the next reset is 00:00 on 15/11.
    expect(
      nextBusinessDayStart(new Date('2026-11-13T17:30:00Z')).toISOString(),
    ).toBe('2026-11-14T17:00:00.000Z');
  });
});
