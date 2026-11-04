/**
 * Where a newly paid plan sits in time, given the paid plans the learner
 * already has. Paid plans are bought 30/90/180 days at a time (no automatic
 * renewal), so a learner who renews before the end must not lose the days
 * left, and one who moves up to PRO must not lose what PLUS days they paid for.
 *
 *  - no paid plan:        starts now;
 *  - same plan:           queued, starts when the current one ends;
 *  - higher plan (PLUS → PRO): starts now; the days left of the current plan
 *    are converted at the ratio of the two daily prices and added;
 *  - lower plan:          refused while the higher one runs;
 *  - a queued plan exists: refused (one queued plan at most).
 *
 * The plan that is in effect is still decided only by startsAt <= now < endsAt
 * (SubscriptionService.resolveEffectivePlan), so a queued plan takes over by
 * itself when the current one ends.
 */
export type PaidTerm = {
  id: number;
  planCode: string;
  startsAt: Date;
  endsAt: Date;
  priceVnd: number | null;
  durationDays: number | null;
};

export type RenewalPurchase = {
  planCode: string;
  priceVnd: number;
  durationDays: number;
};

export type RenewalDecision =
  | { kind: 'NEW'; startsAt: Date; endsAt: Date }
  | {
      kind: 'RENEW';
      startsAt: Date;
      endsAt: Date;
      afterSubscriptionId: number;
    }
  | {
      kind: 'UPGRADE';
      startsAt: Date;
      endsAt: Date;
      endSubscriptionId: number;
      previousEndsAt: Date;
      convertedMs: number;
    }
  | {
      kind: 'REFUSED';
      reason: 'QUEUED_EXISTS' | 'DOWNGRADE' | 'OVERLAP';
      message: string;
    };

const DAY_MS = 24 * 60 * 60 * 1000;
const RANK: Record<string, number> = { FREE: 0, PLUS: 1, PRO: 2 };

const rank = (code: string) => RANK[code] ?? 0;
const PLAN_NAME: Record<string, string> = { PLUS: 'Plus', PRO: 'Pro' };
const planName = (code: string) => PLAN_NAME[code] ?? code;

/** dd/mm/yyyy in Vietnam time (UTC+7, no daylight saving), for learner messages. */
export function vnDate(date: Date): string {
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}

function dailyPrice(price: number | null, days: number | null) {
  return price && price > 0 && days && days > 0 ? price / days : null;
}

/** Days of the old plan, converted to days of the new one at the daily-price ratio. */
export function upgradeConversionMs(
  remainingMs: number,
  from: { priceVnd: number | null; durationDays: number | null },
  to: { priceVnd: number | null; durationDays: number | null },
): number {
  const fromDaily = dailyPrice(from.priceVnd, from.durationDays);
  const toDaily = dailyPrice(to.priceVnd, to.durationDays);
  if (!fromDaily || !toDaily || remainingMs <= 0) return 0;
  return Math.floor(remainingMs * (fromDaily / toDaily));
}

export function decideRenewal(input: {
  now: Date;
  purchase: RenewalPurchase;
  /** Paid, ACTIVE plans that have not ended yet (current and queued). */
  paid: PaidTerm[];
}): RenewalDecision {
  const { now, purchase } = input;
  const nowMs = now.getTime();
  const lengthMs = purchase.durationDays * DAY_MS;
  const current = input.paid.filter(
    (term) => term.startsAt.getTime() <= nowMs && term.endsAt.getTime() > nowMs,
  );
  const queued = input.paid.filter((term) => term.startsAt.getTime() > nowMs);

  if (current.length > 1)
    return {
      kind: 'REFUSED',
      reason: 'OVERLAP',
      message:
        'Tài khoản đang có nhiều gói trả phí cùng lúc. Hãy liên hệ hỗ trợ.',
    };
  if (queued.length > 0)
    return {
      kind: 'REFUSED',
      reason: 'QUEUED_EXISTS',
      message:
        'Bạn đã có một gói gia hạn đang chờ bắt đầu. Có thể mua thêm sau khi gói đó bắt đầu.',
    };
  const active = current[0];
  if (!active)
    return {
      kind: 'NEW',
      startsAt: now,
      endsAt: new Date(nowMs + lengthMs),
    };

  if (rank(purchase.planCode) === rank(active.planCode)) {
    const startsAt = active.endsAt;
    return {
      kind: 'RENEW',
      startsAt,
      endsAt: new Date(startsAt.getTime() + lengthMs),
      afterSubscriptionId: active.id,
    };
  }
  if (rank(purchase.planCode) > rank(active.planCode)) {
    const convertedMs = upgradeConversionMs(
      active.endsAt.getTime() - nowMs,
      active,
      purchase,
    );
    return {
      kind: 'UPGRADE',
      startsAt: now,
      endsAt: new Date(nowMs + lengthMs + convertedMs),
      endSubscriptionId: active.id,
      previousEndsAt: active.endsAt,
      convertedMs,
    };
  }
  return {
    kind: 'REFUSED',
    reason: 'DOWNGRADE',
    message: `Bạn đang dùng gói ${planName(active.planCode)} đến hết ngày ${vnDate(active.endsAt)}. Có thể mua gói ${planName(purchase.planCode)} sau khi gói hiện tại hết hạn.`,
  };
}
