/**
 * Pure item-effect rules for the Bánh Mì shop.
 */

/** "Thẻ nhân đôi Bánh Mì (24h Boost)" lasts 24 hours per card. */
export const DOUBLE_BANH_HOURS_PER_CARD = 24;

/**
 * New end time of the double-reward boost after buying `quantity` cards.
 * A boost still running is extended rather than reset, so a second card never
 * shortens the time already paid for.
 */
export function extendDoubleBanhUntil(
  current: Date | null | undefined,
  quantity: number,
  now: Date = new Date(),
): Date {
  const start = current && current.getTime() > now.getTime() ? current : now;
  return new Date(
    start.getTime() + quantity * DOUBLE_BANH_HOURS_PER_CARD * 60 * 60 * 1000,
  );
}
