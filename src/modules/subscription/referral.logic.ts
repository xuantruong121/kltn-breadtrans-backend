/**
 * Referral rules (owner default, 2026-11-04): a learner shares an invite
 * code; when the invited learner's first payment completes, both get 7 more
 * days. Pure: no Prisma, no I/O.
 */
import { randomInt } from 'node:crypto';

export const REFERRAL_REWARD_DAYS = 7;
/** An invite code can be entered up to this many days after signing up. */
export const REFERRAL_CLAIM_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** e.g. BT-7KQ4M2 (no 0/O/1/I/L to misread). */
export function newReferralCode(random = (n: number) => randomInt(n)): string {
  let tail = '';
  for (let i = 0; i < 6; i += 1) tail += ALPHABET[random(ALPHABET.length)];
  return `BT-${tail}`;
}

export function normalizeReferralCode(code: string): string {
  return code.trim().replace(/\s+/g, '').toUpperCase();
}

export type ClaimRefusal =
  | 'UNKNOWN_CODE'
  | 'OWN_CODE'
  | 'ALREADY_REFERRED'
  | 'TOO_LATE'
  | 'ALREADY_PAID';

const CLAIM_MESSAGES: Record<ClaimRefusal, string> = {
  UNKNOWN_CODE: 'Mã giới thiệu không tồn tại.',
  OWN_CODE: 'Không dùng được mã giới thiệu của chính bạn.',
  ALREADY_REFERRED: 'Tài khoản đã nhập mã giới thiệu trước đó.',
  TOO_LATE: `Chỉ nhập được mã giới thiệu trong ${REFERRAL_CLAIM_DAYS} ngày đầu sau khi đăng ký.`,
  ALREADY_PAID: 'Mã giới thiệu chỉ dành cho tài khoản chưa mua gói nào.',
};

export function decideClaim(input: {
  referrerId: number | null;
  inviteeId: number;
  inviteeCreatedAt: Date;
  now: Date;
  alreadyReferred: boolean;
  inviteePaidPurchases: number;
}): { ok: true } | { ok: false; reason: ClaimRefusal; message: string } {
  const refuse = (reason: ClaimRefusal) =>
    ({ ok: false, reason, message: CLAIM_MESSAGES[reason] }) as const;
  if (input.referrerId === null) return refuse('UNKNOWN_CODE');
  if (input.referrerId === input.inviteeId) return refuse('OWN_CODE');
  if (input.alreadyReferred) return refuse('ALREADY_REFERRED');
  if (
    input.now.getTime() - input.inviteeCreatedAt.getTime() >
    REFERRAL_CLAIM_DAYS * DAY_MS
  )
    return refuse('TOO_LATE');
  if (input.inviteePaidPurchases > 0) return refuse('ALREADY_PAID');
  return { ok: true };
}

export type PaidTermLike = { id: number; endsAt: Date; source: string };

/**
 * How a learner receives reward days (7 by default): the paid plan that ends
 * last (running or queued) is extended, so nothing overlaps and a renewal
 * still queues after it; with no paid plan, a PLUS term of that length starts
 * now. A trial is not a paid plan and is never extended.
 */
export function rewardPlacement(input: {
  now: Date;
  paidTerms: PaidTermLike[];
  days?: number;
}):
  | { kind: 'EXTEND'; subscriptionId: number; newEndsAt: Date }
  | { kind: 'GRANT'; startsAt: Date; endsAt: Date } {
  const days = (input.days ?? REFERRAL_REWARD_DAYS) * DAY_MS;
  const last = input.paidTerms
    .filter(
      (t) => t.source !== 'TRIAL' && t.endsAt.getTime() > input.now.getTime(),
    )
    .reduce<PaidTermLike | null>(
      (best, t) => (!best || t.endsAt > best.endsAt ? t : best),
      null,
    );
  if (last)
    return {
      kind: 'EXTEND',
      subscriptionId: last.id,
      newEndsAt: new Date(last.endsAt.getTime() + days),
    };
  return {
    kind: 'GRANT',
    startsAt: input.now,
    endsAt: new Date(input.now.getTime() + days),
  };
}
