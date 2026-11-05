import {
  getBusinessDayKey,
  getBusinessDayStart,
  getBusinessFiveMinuteKey,
  getBusinessWeekKey,
  getBusinessWeekStart,
  getBusinessWeekday,
  isPastBusinessRollover,
  getPreviousBusinessDayKey,
} from './business-time.util';

describe('business-time.util', () => {
  const afterMidnightIct = new Date('2026-09-15T17:30:00.000Z');

  it('uses Asia/Ho_Chi_Minh for the business day boundary', () => {
    expect(getBusinessDayKey(afterMidnightIct)).toBe('2026-09-16');
    expect(getPreviousBusinessDayKey('2026-09-16')).toBe('2026-09-15');
    expect(getBusinessDayStart('2026-09-16').toISOString()).toBe(
      '2026-09-15T17:00:00.000Z',
    );
  });

  it('returns deterministic ISO week keys and local weekdays', () => {
    expect(getBusinessWeekKey(new Date('2026-09-13T02:00:00.000Z'))).toBe(
      '2026-W37',
    );
    expect(getBusinessWeekday(new Date('2026-09-13T02:00:00.000Z'))).toBe(0);
    // ISO weeks run Monday to Sunday: Sunday 23:59 and Monday 00:00 in Ho Chi
    // Minh City fall in consecutive weeks.
    expect(getBusinessWeekKey(new Date('2026-11-08T16:59:00.000Z'))).toBe(
      '2026-W45',
    );
    expect(getBusinessWeekKey(new Date('2026-11-08T17:00:00.000Z'))).toBe(
      '2026-W46',
    );
    expect(getBusinessWeekKey(new Date('2026-12-31T17:30:00.000Z'))).toBe(
      '2026-W53',
    );
  });

  it('creates a stable five-minute queue bucket', () => {
    const first = getBusinessFiveMinuteKey(
      new Date('2026-09-16T03:02:00.000Z'),
    );
    const second = getBusinessFiveMinuteKey(
      new Date('2026-09-16T03:04:59.999Z'),
    );
    expect(first).toBe(second);
  });

  it('starts the business week on Monday 00:00 in Ho Chi Minh City', () => {
    const monday = '2026-11-08T17:00:00.000Z';
    // Sunday 23:59, Monday 00:00 and Thursday of ISO week 46.
    expect(
      getBusinessWeekStart(new Date('2026-11-08T16:59:00.000Z')).toISOString(),
    ).toBe('2026-11-01T17:00:00.000Z');
    expect(getBusinessWeekStart(new Date(monday)).toISOString()).toBe(monday);
    expect(
      getBusinessWeekStart(new Date('2026-11-12T05:00:00.000Z')).toISOString(),
    ).toBe(monday);
  });

  it('counts a period as started only from 00:01', () => {
    const start = getBusinessDayStart('2026-11-06');
    const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

    expect(isPastBusinessRollover(start, at(0))).toBe(false);
    expect(isPastBusinessRollover(start, at(59))).toBe(false);
    expect(isPastBusinessRollover(start, at(60))).toBe(true);
  });
});
