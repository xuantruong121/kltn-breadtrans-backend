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
  const localDate = new Date(`${dayKey}T00:00:00+07:00`);
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
