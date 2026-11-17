import { studiedWeekdays, vietnamWeekStart } from './study-week.logic';

describe('vietnamWeekStart', () => {
  it('is Monday 00:00 in Vietnam (17:00 UTC on Sunday)', () => {
    // Thursday 19/11/2026 12:00 VN
    expect(vietnamWeekStart(new Date('2026-11-19T05:00:00Z'))).toEqual(
      new Date('2026-11-15T17:00:00Z'),
    );
  });

  it('Monday 00:10 VN is already the new week; Sunday 23:30 VN still the old one', () => {
    expect(vietnamWeekStart(new Date('2026-11-15T17:10:00Z'))).toEqual(
      new Date('2026-11-15T17:00:00Z'),
    );
    expect(vietnamWeekStart(new Date('2026-11-15T16:30:00Z'))).toEqual(
      new Date('2026-11-08T17:00:00Z'),
    );
  });
});

describe('studiedWeekdays', () => {
  const now = new Date('2026-11-19T05:00:00Z'); // Thursday 12:00 VN

  it('maps each moment to its Vietnam weekday, 0 = T2 … 6 = CN', () => {
    expect(
      studiedWeekdays(
        [
          new Date('2026-11-15T17:10:00Z'), // Mon 00:10 VN
          new Date('2026-11-16T17:30:00Z'), // Tue 00:30 VN, Monday in UTC
          new Date('2026-11-19T04:00:00Z'), // Thu 11:00 VN
        ],
        now,
      ),
    ).toEqual([0, 1, 3]);
  });

  it('counts a day once, sorts, and leaves out the previous week', () => {
    expect(
      studiedWeekdays(
        [
          new Date('2026-11-18T10:00:00Z'), // Wed
          new Date('2026-11-15T16:30:00Z'), // Sun 23:30 VN, last week
          new Date('2026-11-16T02:00:00Z'), // Mon
          new Date('2026-11-18T01:00:00Z'), // Wed again
        ],
        now,
      ),
    ).toEqual([0, 2]);
  });

  it('no XP this week is an empty list', () => {
    expect(studiedWeekdays([], now)).toEqual([]);
  });
});
