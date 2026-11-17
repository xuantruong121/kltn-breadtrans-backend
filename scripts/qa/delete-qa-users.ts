import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Deletes QA users that a script created for itself, with the rows that keep
 * a Restrict key to User.
 *
 * Since 2026-11-16 orders, the Bánh Mì ledger, used promo codes and payments
 * are never lost with a user (soft-delete rule), so a plain `user.delete`
 * fails once a QA learner earned Bánh Mì or bought a plan, and the account
 * stays behind as junk. Junk may be hard-deleted; real accounts go through
 * AccountPurgeService instead. Never point this at users the script did not
 * create.
 *
 * Takes a client or a transaction client; returns `{ count }` like
 * `user.deleteMany`.
 */
export async function deleteQaUsers(
  db: Db,
  args: { where: Prisma.UserWhereInput },
): Promise<{ count: number }> {
  const run = async (tx: Prisma.TransactionClient) => {
    const ids = (
      await tx.user.findMany({ where: args.where, select: { id: true } })
    ).map((u) => u.id);
    if (!ids.length) return { count: 0 };
    const own = { userId: { in: ids } };
    // Foreign-key order: children before the rows they point at.
    await tx.payOSPaymentIntent.deleteMany({ where: own });
    await tx.subscription.deleteMany({ where: own });
    await tx.promoRedemption.deleteMany({ where: own });
    await tx.planPayment.deleteMany({
      where: { planPurchase: { userId: { in: ids } } },
    });
    await tx.planPurchase.deleteMany({ where: own });
    await tx.marketPhysicalRedemption.deleteMany({ where: own });
    await tx.marketOrder.deleteMany({ where: own });
    await tx.banhTransaction.deleteMany({ where: own });
    return tx.user.deleteMany({ where: { id: { in: ids } } });
  };
  return '$transaction' in db ? db.$transaction(run) : run(db);
}
