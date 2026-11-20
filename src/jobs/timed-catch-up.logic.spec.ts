import { missedTimedJobs } from './timed-catch-up.logic';

/** Times are Asia/Ho_Chi_Minh (UTC+7); Monday is 2026-11-16. */
describe('missedTimedJobs', () => {
  const at = (iso: string) => missedTimedJobs(new Date(iso));

  it('owes nothing on Monday before 08:00', () => {
    // Monday 07:59 local.
    expect(at('2026-11-16T00:59:00.000Z')).toEqual({
      planExpiryDayKey: null,
      weeklyReportDayKey: null,
    });
  });

  it('owes the weekly report from Monday 08:00, the plan reminder from 09:00', () => {
    // Monday 08:30 local.
    expect(at('2026-11-16T01:30:00.000Z')).toEqual({
      planExpiryDayKey: null,
      weeklyReportDayKey: '2026-11-16',
    });
    // Monday 09:00 local.
    expect(at('2026-11-16T02:00:00.000Z')).toEqual({
      planExpiryDayKey: '2026-11-16',
      weeklyReportDayKey: '2026-11-16',
    });
  });

  it("keeps the week's Monday key for the rest of the week", () => {
    // Thursday 2026-11-19 08:00 local: report still owed under Monday's key.
    expect(at('2026-11-19T01:00:00.000Z')).toEqual({
      planExpiryDayKey: null,
      weeklyReportDayKey: '2026-11-16',
    });
    // Sunday 2026-11-22 23:30 local.
    expect(at('2026-11-22T16:30:00.000Z')).toEqual({
      planExpiryDayKey: '2026-11-22',
      weeklyReportDayKey: '2026-11-16',
    });
  });
});
