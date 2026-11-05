export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  weekday: 'short',
});

export function getBusinessDayKey(date = new Date()): string {
  const parts = partsFormatter.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function getPreviousBusinessDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return date.toISOString().slice(0, 10);
}

export function getBusinessWeekKey(date = new Date()): string {
  const dayKey = getBusinessDayKey(date);
  // The calendar day at UTC midnight, so getUTCDay() is that day's weekday.
  // Midnight +07:00 read with getUTCDay() gave the previous day and put each
  // Monday in the week before.
  const localDate = new Date(`${dayKey}T00:00:00Z`);
  const day = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(localDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((localDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${localDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function getBusinessDayStart(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00+07:00`);
}

export function getBusinessWeekday(date = new Date()): number {
  const weekday = weekdayFormatter.format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
}

export function getBusinessFiveMinuteKey(date = new Date()): string {
  return `${getBusinessDayKey(date)}-${Math.floor(date.getTime() / 300_000)}`;
}

/** Monday 00:00 (Asia/Ho_Chi_Minh) of the business week containing `date`. */
export function getBusinessWeekStart(date = new Date()): Date {
  const start = getBusinessDayStart(getBusinessDayKey(date));
  const weekday = getBusinessWeekday(date);
  return new Date(start.getTime() - ((weekday + 6) % 7) * 86_400_000);
}

/**
 * Day and week jobs run at 00:01, never 00:00: one minute clear of the
 * boundary. A startup catch-up waits for the same minute, so a backend that
 * starts at 00:00:30 leaves the period to the 00:01 cron.
 */
export const BUSINESS_ROLLOVER_DELAY_MS = 60_000;

export function isPastBusinessRollover(
  periodStart: Date,
  now = new Date(),
): boolean {
  return now.getTime() >= periodStart.getTime() + BUSINESS_ROLLOVER_DELAY_MS;
}
