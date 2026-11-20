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
 * Where the server writes a learner's recordings. Every prefix carries the
 * owner (user id, or the diagnostic attempt), so a key outside them is never
 * this learner's to delete.
 */
const RECORDING_PREFIXES = [
  'premium/speaking/practice/',
  'premium/speaking/diagnostic/',
  'speaking/pending/',
] as const;

/** A plain object key: no scheme, no leading slash, no `..` or backslash. */
function plainKey(value: string | null | undefined): string | null {
  const key = (value ?? '').trim();
  if (!key || key.startsWith('/') || key.includes('://')) return null;
  if (key.includes('\\') || key.split('/').includes('..')) return null;
  return key;
}

/**
 * The R2 key of a recording the server stored for this learner, or null.
 * Security review 2026-11-21: the purge used to delete whatever a learner had
 * typed into their avatar or a suggestion link, so a throwaway account could
 * delete exam media or another learner's file. Only server-written recording
 * keys under the owner's own prefix are deleted now:
 * - a speaking practice recording or upload intent: under the user's id;
 * - a diagnostic speaking answer: under its assessment and attempt.
 */
export function ownedRecordingKey(
  ref:
    | { kind: 'speaking'; key: string | null | undefined }
    | {
        kind: 'diagnostic';
        key: string | null | undefined;
        assessmentId: number;
        attemptId: number;
      },
  userId: number,
): string | null {
  const key = plainKey(ref.key);
  if (!key) return null;
  const allowed =
    ref.kind === 'speaking'
      ? [
          `premium/speaking/practice/${userId}/`,
          `premium/speaking/practice/legacy/${userId}/`,
          `premium/speaking/practice/pending/${userId}/`,
          `speaking/pending/${userId}/`,
        ]
      : [`premium/speaking/diagnostic/${ref.assessmentId}/${ref.attemptId}/`];
  return allowed.some((prefix) => key.startsWith(prefix)) ? key : null;
}

/**
 * Whether a key queued for a delete retry is a learner recording at all. A key
 * queued before the 2026-11-21 fix may be anything a learner typed; those are
 * dropped instead of retried.
 */
export function isRecordingKey(value: string | null | undefined): boolean {
  const key = plainKey(value);
  return !!key && RECORDING_PREFIXES.some((prefix) => key.startsWith(prefix));
}
