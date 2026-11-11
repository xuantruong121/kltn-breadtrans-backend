/**
 * "Khiên giữ chuỗi" (owner 2026-11-11: one name everywhere; the database
 * field is UserStats.streakFreezes). A shield is used by itself when the
 * learner misses a day, so the streak goes on; the learner is told each time
 * one is used, and how many are left.
 *
 * Pure: no Prisma, no I/O.
 */

export const STREAK_SHIELD_NAME = 'khiên giữ chuỗi';

/** Notification type written when a shield is used. */
export const STREAK_SHIELD_USED_TYPE = 'streak_shield_used';

/** Shop items that are shields (the seed's slug, and older names). */
export function isStreakShieldProduct(product: {
  slug?: string | null;
  name: string;
}): boolean {
  return (
    product.slug === 'streak-freeze' ||
    product.name.includes('Khiên') ||
    product.name.toLowerCase().includes('streak')
  );
}

/** What the learner is told after a shield kept their streak. */
export function streakShieldUsedNotice(input: {
  /** The streak the shield kept, in days. */
  streak: number;
  /** Shields left after this one. */
  remaining: number;
}) {
  const streak = Math.max(0, Math.floor(input.streak));
  const remaining = Math.max(0, Math.floor(input.remaining));
  return {
    type: STREAK_SHIELD_USED_TYPE,
    title: `Khiên giữ chuỗi đã giữ chuỗi ${streak} ngày của bạn`,
    body:
      `Bạn đã lỡ một ngày học nên 1 khiên giữ chuỗi được dùng tự động. ` +
      (remaining > 0
        ? `Bạn còn ${remaining} khiên.`
        : 'Bạn đã hết khiên: lỡ thêm một ngày nữa thì chuỗi sẽ về 0.'),
    url: '/dashboard',
  };
}
