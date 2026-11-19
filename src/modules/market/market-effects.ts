/**
 * Pure item-effect rules for the Bánh Mì shop.
 */

/**
 * "Thẻ 7 ngày Plus" (owner, 2026-11-08, in place of the Phúc Long voucher that
 * could not be supplied): each card adds 7 days to the learner's plan at once,
 * or starts 7 days of Plus when there is none.
 */
export const PLUS_CARD_SLUG = 'plus-7d';
export const PLUS_CARD_DAYS = 7;

/** "Thẻ nhân đôi Bánh Mì (24 giờ)" lasts 24 hours per card. */
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

/**
 * "Pet Bun đồng hành" unlocks the Bun pet (owner 2026-11-19). Ownership is the
 * order itself: a learner owns Bun while an approved or completed order holds
 * the product, so a refund takes it back and buyers from before this rule own
 * it already. The species key is not "bun": seeded pets are named "Bun".
 */
export const PET_BUN_SLUG = 'pet-bun';
export const PET_BUN_SPECIES = 'petbun';
export const OWNING_ORDER_STATUSES = ['approved', 'completed'];

/** Whether any of these orders (one learner's) holds the product. */
export function ordersHoldSlug(
  orders: Array<{ items: unknown }>,
  slug: string,
): boolean {
  return orders.some(
    (order) =>
      Array.isArray(order.items) &&
      (order.items as Array<{ slug?: unknown } | null>).some(
        (item) => item?.slug === slug,
      ),
  );
}
