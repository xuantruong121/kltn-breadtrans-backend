/**
 * Nothing runs at 00:00 Asia/Ho_Chi_Minh (owner 2026-11-27): the day turns at
 * 00:01, and a job that fires on the stroke of midnight races the turn. A job
 * that repeats through the day keeps its rhythm but moves its 00:00 run to
 * 00:02.
 *
 * `@Cron` keeps one schedule per method (a second decorator overwrites the
 * first), so each such job has two methods that call one body: one with the
 * day schedule, one with hour 0.
 */
export const OFF_MIDNIGHT_CRON = {
  /** Every hour from 01:00 to 23:00. */
  hourly: '0 1-23 * * *',
  /** The 00:00 run of an hourly job, moved to 00:02. */
  hourlyAfterMidnight: '2 0 * * *',
  /** Every five minutes from 01:00 to 23:55. */
  everyFiveMinutes: '*/5 1-23 * * *',
  /** Hour 0: 00:02 instead of 00:00, then 00:05 to 00:55 as before. */
  everyFiveMinutesAfterMidnight: '2,5,10,15,20,25,30,35,40,45,50,55 0 * * *',
} as const;
