/**
 * Self-service account deletion (owner 2026-11-16).
 *
 * The account is locked at request and purged DELETION_GRACE_DAYS later,
 * well inside the 20 days the owner asked for; signing in before then offers
 * to cancel. Personal and learning data is deleted for real (the law asks for
 * it). Important records are kept by the soft-delete rule (memory
 * breadtrans-soft-delete-rule): orders, payments, purchased plans, the Bánh Mì
 * ledger and used promo codes move to a new anonymous shell user before the
 * account is deleted, and the shell has no e-mail, name, password or login.
 *
 * Pure: no Prisma, no I/O.
 */

export const DELETION_GRACE_DAYS = 7;
export const DAY_MS = 86_400_000;

export const PENDING_DELETION_CODE = 'ACCOUNT_PENDING_DELETION';
/** Redis key of a one-time cancel token handed out after a valid sign-in. */
export const cancelTokenKey = (token: string) =>
  `account:deletion:cancel:${token}`;
export const CANCEL_TOKEN_TTL_SECONDS = 600;
/** Redis set of R2 keys whose deletion failed, retried by the next purge. */
export const R2_RETRY_SET = 'account:purge:r2-retry';

export const deletionScheduledAt = (requestedAt: Date) =>
  new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);

/** The shell's e-mail: unique, not a mailbox (.invalid is reserved, RFC 2606). */
export const shellEmail = (originalUserId: number, now: Date) =>
  `deleted-${originalUserId}-${now.getTime()}@deleted.invalid`;

/**
 * Tables whose rows survive the deletion, moved to the shell. Each has a
 * `userId` column; the first group keeps a Restrict foreign key to User.
 */
export const KEPT_TABLES = [
  'subscription',
  'planPurchase',
  'payOSPaymentIntent',
  'marketOrder',
  'marketPhysicalRedemption',
  'banhTransaction',
  'promoRedemption',
  // A bare userId column, no foreign key: kept with the ledger.
  'currencyTransaction',
] as const;
export type KeptTable = (typeof KEPT_TABLES)[number];

export const hasKeptRecords = (counts: Record<KeptTable, number>) =>
  KEPT_TABLES.some((t) => (counts[t] ?? 0) > 0);

/** What a physical redemption keeps once its owner is gone: the order, not the person. */
export const SCRUBBED_RECIPIENT = {
  recipientName: 'Đã xoá theo yêu cầu',
  phone: '',
  provinceCode: '',
  provinceName: '',
  wardCode: '',
  wardName: '',
  addressLine: '',
  formattedAddress: '',
};

/**
 * The R2 key behind a stored file reference: a key as is, or a URL under our
 * public bucket address. Anything else (a Google avatar, another host) is not
 * ours to delete: null.
 */
export function storageKeyOf(
  ref: string | null | undefined,
  publicBaseUrl: string,
): string | null {
  const value = (ref ?? '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '') || null;
  const base = publicBaseUrl.replace(/\/+$/, '');
  if (!base || !value.startsWith(`${base}/`)) return null;
  const key = decodeURIComponent(value.slice(base.length + 1).split(/[?#]/)[0]);
  return key || null;
}
