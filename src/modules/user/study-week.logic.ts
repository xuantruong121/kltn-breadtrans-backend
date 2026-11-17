/**
 * The days of the current week a learner studied, for the dashboard's
 * "Tuần này" row (owner 2026-11-17). A day counts when it holds XP
 * (PointHistory with points > 0): the same events that keep the streak, so
 * the row and the streak never disagree. Weeks run Monday to Sunday in
 * Vietnam time (UTC+7, no daylight saving).
 *
 * Pure: no Prisma, no I/O.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since Monday (0 = T2 … 6 = CN) of a moment, in Vietnam time. */
function vietnamWeekday(moment: Date): number {
  const local = new Date(moment.getTime() + VN_OFFSET_MS);
  return (local.getUTCDay() + 6) % 7;
}

/** Monday 00:00 Vietnam time of the week that contains `now`. */
export function vietnamWeekStart(now: Date): Date {
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(localMidnight - vietnamWeekday(now) * DAY_MS - VN_OFFSET_MS);
}

/** Weekdays (0 = T2 … 6 = CN) of this Vietnam week with at least one moment. */
export function studiedWeekdays(moments: Date[], now: Date): number[] {
  const start = vietnamWeekStart(now).getTime();
  const end = start + 7 * DAY_MS;
  const days = new Set<number>();
  for (const moment of moments) {
    const time = moment.getTime();
    if (time >= start && time < end) days.add(vietnamWeekday(moment));
  }
  return [...days].sort((a, b) => a - b);
}
