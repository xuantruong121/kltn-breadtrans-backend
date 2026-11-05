/**
 * The weekly league resets at Monday 00:01 (Asia/Ho_Chi_Minh), so a league
 * week runs Monday to Sunday like every other week in the product.
 *
 * Until 2026-11-05 it reset at Sunday 00:00 and recorded the ISO week that
 * Sunday belongs to, so that reset in fact opened the next week one day
 * early. The startup catch-up therefore treats a reset done from the Sunday
 * before this week's Monday onward as this week's reset, and does not reset
 * the league a second time mid-week.
 */
export function weeklyCatchUpDue(
  last: { lastProcessedWeek?: unknown; processedAt?: unknown },
  weekKey: string,
  weekStart: Date,
): boolean {
  if (last.lastProcessedWeek === weekKey) return false;
  const at =
    typeof last.processedAt === 'string' ? Date.parse(last.processedAt) : NaN;
  return !(Number.isFinite(at) && at >= weekStart.getTime() - 86_400_000);
}
