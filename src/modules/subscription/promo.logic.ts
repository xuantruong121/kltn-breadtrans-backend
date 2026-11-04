/**
 * Promo-code pricing and eligibility. Pure: no Prisma, no I/O, so every rule
 * is pinned by a spec. The service loads the code and the counts, asks here,
 * and stores what comes back.
 */
import { randomInt } from 'node:crypto';

export type PromoCodeRow = {
  id: number;
  code: string;
  percentOff: number;
  validFrom: Date | null;
  validTo: Date | null;
  planCodes: string[];
  maxRedemptions: number | null;
  perUserOnce: boolean;
  userId: number | null;
  active: boolean;
};

export type PromoRefusal =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'WRONG_PLAN'
  | 'NOT_YOURS'
  | 'ALREADY_USED'
  | 'USED_UP';

export type PromoDecision =
  | {
      ok: true;
      promoCodeId: number;
      percentOff: number;
      listPriceVnd: number;
      discountVnd: number;
      amountVnd: number;
    }
  | { ok: false; reason: PromoRefusal; message: string };

const MESSAGES: Record<PromoRefusal, string> = {
  NOT_FOUND: 'Mã giảm giá không tồn tại.',
  INACTIVE: 'Mã giảm giá đã ngừng sử dụng.',
  NOT_STARTED: 'Mã giảm giá chưa đến ngày dùng.',
  EXPIRED: 'Mã giảm giá đã hết hạn.',
  WRONG_PLAN: 'Mã giảm giá không áp dụng cho gói này.',
  NOT_YOURS: 'Mã giảm giá này dành cho tài khoản khác.',
  ALREADY_USED: 'Bạn đã dùng mã giảm giá này rồi.',
  USED_UP: 'Mã giảm giá đã hết lượt dùng.',
};

/** Codes are typed loosely and stored upper-case without spaces. */
export function normalizePromoCode(code: string): string {
  return code.trim().replace(/\s+/g, '').toUpperCase();
}

/**
 * The discount, rounded down to a whole thousand VND so the price stays
 * readable (69,000 at 20% → 13,000 off → 56,000).
 */
export function promoDiscountVnd(listPriceVnd: number, percentOff: number) {
  if (listPriceVnd <= 0 || percentOff <= 0) return 0;
  const raw = (listPriceVnd * Math.min(percentOff, 90)) / 100;
  return Math.floor(raw / 1000) * 1000;
}

export function refuse(reason: PromoRefusal): PromoDecision {
  return { ok: false, reason, message: MESSAGES[reason] };
}

export function evaluatePromo(input: {
  promo: PromoCodeRow | null;
  now: Date;
  planCode: string;
  userId: number;
  listPriceVnd: number;
  /** Completed purchases of this learner that used the code. */
  usedByUser: number;
  /** Completed purchases that used the code, plus other learners' open payments with it. */
  usedTotal: number;
}): PromoDecision {
  const { promo, now } = input;
  if (!promo) return refuse('NOT_FOUND');
  if (!promo.active) return refuse('INACTIVE');
  if (promo.validFrom && now < promo.validFrom) return refuse('NOT_STARTED');
  if (promo.validTo && now >= promo.validTo) return refuse('EXPIRED');
  if (promo.userId !== null && promo.userId !== input.userId)
    return refuse('NOT_YOURS');
  if (promo.planCodes.length && !promo.planCodes.includes(input.planCode))
    return refuse('WRONG_PLAN');
  if (promo.perUserOnce && input.usedByUser > 0) return refuse('ALREADY_USED');
  if (promo.maxRedemptions !== null && input.usedTotal >= promo.maxRedemptions)
    return refuse('USED_UP');
  const discountVnd = promoDiscountVnd(input.listPriceVnd, promo.percentOff);
  return {
    ok: true,
    promoCodeId: promo.id,
    percentOff: promo.percentOff,
    listPriceVnd: input.listPriceVnd,
    discountVnd,
    amountVnd: input.listPriceVnd - discountVnd,
  };
}

/**
 * The terms a purchase was frozen with still describe its plan version:
 * list price = version price, amount = list price - discount, and a discount
 * only with a code.
 */
export function frozenPriceHolds(input: {
  versionPriceVnd: number | null;
  listPriceVnd: number;
  discountVnd: number;
  amountVnd: number;
  promoCodeId: number | null;
}): boolean {
  return (
    input.versionPriceVnd !== null &&
    input.listPriceVnd === input.versionPriceVnd &&
    input.discountVnd >= 0 &&
    input.amountVnd === input.listPriceVnd - input.discountVnd &&
    (input.discountVnd === 0 || input.promoCodeId !== null)
  );
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A personal win-back code, e.g. QUAYLAI-7KQ4M2 (no 0/O/1/I/L to misread). */
export function winbackCode(random = (n: number) => randomInt(n)): string {
  let tail = '';
  for (let i = 0; i < 6; i += 1) tail += ALPHABET[random(ALPHABET.length)];
  return `QUAYLAI-${tail}`;
}

export const WINBACK_PERCENT = 20;
export const WINBACK_VALID_DAYS = 7;
/** Sent this many Vietnam days after a paid plan ended. */
export const WINBACK_AFTER_DAYS = 3;
