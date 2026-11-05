import { weeklyCatchUpDue } from './weekly-league.logic';

describe('weeklyCatchUpDue', () => {
  // Monday 00:00 in Ho Chi Minh City of ISO weeks 45 and 46 of 2026.
  const w45 = new Date('2026-11-01T17:00:00.000Z');
  const w46 = new Date('2026-11-08T17:00:00.000Z');
  // The last reset under the old Sunday 00:00 schedule, as stored.
  const legacySunday = {
    lastProcessedWeek: '2026-W44',
    processedAt: '2026-10-31T17:00:00.193Z',
  };

  it('treats the old Sunday 00:00 reset as this week, so a restart does not reset mid-week', () => {
    expect(weeklyCatchUpDue(legacySunday, '2026-W45', w45)).toBe(false);
  });

  it('is due the following week', () => {
    expect(weeklyCatchUpDue(legacySunday, '2026-W46', w46)).toBe(true);
  });

  it('is not due again once this week was reset at Monday 00:01', () => {
    const monday = {
      lastProcessedWeek: '2026-W46',
      processedAt: '2026-11-08T17:01:00.120Z',
    };

    expect(weeklyCatchUpDue(monday, '2026-W46', w46)).toBe(false);
    expect(
      weeklyCatchUpDue(
        monday,
        '2026-W47',
        new Date('2026-11-15T17:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('is due when the league was never reset', () => {
    expect(weeklyCatchUpDue({}, '2026-W45', w45)).toBe(true);
  });
});
