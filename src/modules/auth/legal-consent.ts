/**
 * Consent to the terms of use and the privacy policy (owner 2026-11-16).
 *
 * A learner accepts both documents at sign-up, by ticking a box that is never
 * pre-ticked, and again whenever LEGAL_VERSION changes. Each acceptance is
 * stored as evidence: who, which document, which version, when, how and from
 * where (UserConsent). LEGAL_VERSION is the "Cập nhật ngày" date shown on
 * /terms and /privacy; change both together.
 *
 * Pure: no Prisma, no I/O.
 */

export const LEGAL_VERSION = '2026-11-16';
export const LEGAL_DOCUMENTS = ['TERMS', 'PRIVACY'] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];
export type ConsentMethod = 'EMAIL_SIGNUP' | 'GOOGLE_SIGNUP' | 'PROMPT';

export const CONSENT_REQUIRED_CODE = 'CONSENT_REQUIRED';
export const CONSENT_REQUIRED_MESSAGE =
  'Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật để tạo tài khoản.';

/** True while the user has not accepted the current version of both documents. */
export function consentRequired(
  consents: Array<{ document: string; version: string }>,
  version: string = LEGAL_VERSION,
): boolean {
  return LEGAL_DOCUMENTS.some(
    (doc) => !consents.some((c) => c.document === doc && c.version === version),
  );
}

export type ConsentMeta = { ip?: string | null; userAgent?: string | null };

/** The UserConsent rows for one acceptance of both documents. */
export function consentRows(
  method: ConsentMethod,
  meta: ConsentMeta = {},
  version: string = LEGAL_VERSION,
) {
  const ip = meta.ip ? meta.ip.slice(0, 64) : null;
  const userAgent = meta.userAgent ? meta.userAgent.slice(0, 255) : null;
  return LEGAL_DOCUMENTS.map((document) => ({
    document,
    version,
    method,
    ip,
    userAgent,
  }));
}
