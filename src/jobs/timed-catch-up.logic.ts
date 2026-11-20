import {
  getBusinessDayKey,
  getBusinessDayStart,
  getBusinessWeekStart,
} from '../common/time/business-time.util';

const HOUR_MS = 3_600_000;

/** The plan reminder runs daily at 09:00, the weekly report Monday 08:00 (Asia/Ho_Chi_Minh). */
export const PLAN_EXPIRY_HOUR = 9;
export const WEEKLY_REPORT_HOUR = 8;

/**
 * Timed jobs a backend that was off at their hour still owes (owner
 * 2026-11-20: a dev host off at 08:00 Monday skipped the weekly report, and
 * one off at 09:00 the plan reminder). Each key is the one the cron would have
 * used, so a catch-up and the cron share a job id; both jobs also skip a
 * learner who already has that notification.
 * - plan reminder: today, once 09:00 has passed;
 * - weekly report: this week's Monday, from Monday 08:00 to Sunday.
 */
export function missedTimedJobs(now: Date) {
  const dayKey = getBusinessDayKey(now);
  const dayStart = getBusinessDayStart(dayKey);
  const weekStart = getBusinessWeekStart(now);
  return {
    planExpiryDayKey:
      now.getTime() >= dayStart.getTime() + PLAN_EXPIRY_HOUR * HOUR_MS
        ? dayKey
        : null,
    weeklyReportDayKey:
      now.getTime() >= weekStart.getTime() + WEEKLY_REPORT_HOUR * HOUR_MS
        ? getBusinessDayKey(weekStart)
        : null,
  };
}
