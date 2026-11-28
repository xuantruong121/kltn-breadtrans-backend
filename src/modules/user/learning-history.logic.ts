/**
 * Paging of the learner's activity history. Pure: no Prisma, no clock.
 *
 * The learner app groups rows of one day and one kind into a single entry
 * ("Đã ghi nhớ 5 từ vựng"). A page therefore always holds WHOLE learner days,
 * so a group is never cut in two at a page edge. Days are learner days (they
 * turn at 00:01 Vietnam time, see business-time.util.ts).
 */

export interface HistoryDayCount {
  /** Learner day, YYYY-MM-DD. */
  dayKey: string;
  count: number;
}

export interface HistoryPage {
  /** Newest learner day on the page. */
  newestDayKey: string;
  /** Oldest learner day on the page. */
  oldestDayKey: string;
  /** Rows on the page. */
  rows: number;
}

/** A page closes once it holds at least this many rows. */
export const HISTORY_MIN_PAGE_ROWS = 20;

/**
 * Safety cap on the rows one page may return. A day is never split, so a day
 * with more rows than this is still one page, but only this many (the newest)
 * are sent.
 */
export const HISTORY_MAX_PAGE_ROWS = 1000;

/**
 * Cuts the days, newest first, into pages of whole days. Days with no rows are
 * ignored. A page takes days until it holds `minRows` rows or more.
 */
export function planHistoryPages(
  dayCounts: HistoryDayCount[],
  minRows = HISTORY_MIN_PAGE_ROWS,
): HistoryPage[] {
  const days = dayCounts
    .filter((day) => day.count > 0)
    .sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0));
  const pages: HistoryPage[] = [];
  let current: HistoryPage | null = null;
  for (const day of days) {
    if (!current) {
      current = {
        newestDayKey: day.dayKey,
        oldestDayKey: day.dayKey,
        rows: day.count,
      };
    } else {
      current.oldestDayKey = day.dayKey;
      current.rows += day.count;
    }
    if (current.rows >= minRows) {
      pages.push(current);
      current = null;
    }
  }
  if (current) pages.push(current);
  return pages;
}

/** A page number that exists: whole numbers from 1, 1 when nothing was asked. */
export function clampHistoryPage(
  requested: number | undefined,
  pageCount: number,
): number {
  const wanted =
    typeof requested === 'number' && Number.isFinite(requested)
      ? Math.trunc(requested)
      : 1;
  return Math.min(Math.max(wanted, 1), Math.max(pageCount, 1));
}

/** The day after `dayKey` (YYYY-MM-DD, no time zone involved). */
export function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * Rows per day for the `length` learner days ending at `todayKey`, oldest
 * first, with 0 for a day without rows. Feeds the 7-day strip, which must not
 * depend on how many rows one page happens to hold.
 */
export function lastDaysCounts(
  dayCounts: HistoryDayCount[],
  todayKey: string,
  length = 7,
): HistoryDayCount[] {
  const byDay = new Map(dayCounts.map((day) => [day.dayKey, day.count]));
  const days: string[] = [todayKey];
  while (days.length < length) {
    const [year, month, day] = days[0].split('-').map(Number);
    days.unshift(
      new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10),
    );
  }
  return days.map((dayKey) => ({ dayKey, count: byDay.get(dayKey) ?? 0 }));
}
