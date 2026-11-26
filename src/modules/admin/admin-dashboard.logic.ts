import { Prisma } from '@prisma/client';
import {
  getBusinessDayKey,
  getBusinessDayStart,
} from '../../common/time/business-time.util';

export const DASHBOARD_RANGES = ['30d', '6m', '12m'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

const DAY_MS = 86_400_000;

/** The 30-day view opens first (2026-11-26). */
export function normalizeDashboardRange(value?: string): DashboardRange {
  return DASHBOARD_RANGES.includes(value as DashboardRange)
    ? (value as DashboardRange)
    : '30d';
}

/**
 * 00:00 Vietnam time of a calendar date. Month and day may overflow
 * (day 0 is the last day of the month before), as with Date.UTC.
 */
function vnDayStart(year: number, monthIndex: number, day: number) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return {
    start: getBusinessDayStart(date.toISOString().slice(0, 10)),
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
  };
}

function today(now: Date) {
  const [year, month, day] = getBusinessDayKey(now).split('-').map(Number);
  return { year, monthIndex: month - 1, day };
}

/**
 * One bucket per day (30d) or per month (6m, 12m), oldest first, on Vietnam
 * calendar days whatever the server's timezone: on a UTC server, Node local
 * time put 00:00–07:00 of each Vietnam day in the day before.
 */
export function buildDashboardBuckets(range: DashboardRange, now = new Date()) {
  const { year, monthIndex, day } = today(now);

  if (range === '30d') {
    return Array.from({ length: 30 }, (_, index) => {
      const bucket = vnDayStart(year, monthIndex, day - (29 - index));
      return {
        label: `${bucket.day}/${bucket.month}`,
        start: bucket.start,
        end: new Date(bucket.start.getTime() + DAY_MS - 1),
      };
    });
  }

  const monthCount = range === '12m' ? 12 : 6;
  return Array.from({ length: monthCount }, (_, index) => {
    const offset = monthCount - 1 - index;
    const bucket = vnDayStart(year, monthIndex - offset, 1);
    const next = vnDayStart(year, monthIndex - offset + 1, 1);
    return {
      label: `T${bucket.month}`,
      start: bucket.start,
      end: new Date(next.start.getTime() - 1),
    };
  });
}

/**
 * Where the period before the chosen one begins: the 30 days before the last
 * 30, or the 6 (12) months before the last 6 (12). It ends where the chosen
 * one starts.
 */
export function previousDashboardStart(
  range: DashboardRange,
  now = new Date(),
): Date {
  const { year, monthIndex, day } = today(now);
  if (range === '30d') return vnDayStart(year, monthIndex, day - 59).start;
  const monthCount = range === '12m' ? 12 : 6;
  return vnDayStart(year, monthIndex - (2 * monthCount - 1), 1).start;
}

/**
 * A learner who learned in the window: an attempt or a learning activity.
 * Signing in alone does not count (2026-11-26: "Hoạt động" counted learners
 * who only opened the app).
 */
export function learnedWithin(
  within: Prisma.DateTimeFilter,
): Prisma.UserWhereInput[] {
  return [
    { learningActivities: { some: { occurredAt: within } } },
    { submissions: { some: { submittedAt: within } } },
    { speakingSubmissions: { some: { submittedAt: within } } },
    { diagnosticAttempts: { some: { submittedAt: within } } },
    { contentAttempts: { some: { submittedAt: within } } },
    { grammarAttempts: { some: { createdAt: within } } },
    { toeicAttempts: { some: { createdAt: within } } },
  ];
}
