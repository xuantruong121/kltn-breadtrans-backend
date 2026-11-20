import { ordersHoldSlug } from '../market/market-effects';

export type CosmeticsChange = {
  avatarFrame?: string | null;
  badgeKey?: string | null;
};

/** Only the fields sent are changed; null takes an item off. */
export function cosmeticsData(change: CosmeticsChange): CosmeticsChange {
  const data: CosmeticsChange = {};
  if (change.avatarFrame !== undefined) data.avatarFrame = change.avatarFrame;
  if (change.badgeKey !== undefined) data.badgeKey = change.badgeKey;
  return data;
}

/**
 * The first item the learner wants to wear without owning it, or null. Owning
 * means an approved or completed order holds it, so a refund takes it back.
 */
export function unownedCosmetic(
  change: CosmeticsChange,
  owningOrders: Array<{ items: unknown }>,
): string | null {
  for (const slug of [change.avatarFrame, change.badgeKey])
    if (typeof slug === 'string' && !ordersHoldSlug(owningOrders, slug))
      return slug;
  return null;
}
