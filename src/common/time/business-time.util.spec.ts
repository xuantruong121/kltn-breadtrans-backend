import {
  getBusinessDayKey,
  getBusinessDayStart,
  getBusinessFiveMinuteKey,
  getBusinessWeekKey,
  getBusinessWeekday,
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
});
