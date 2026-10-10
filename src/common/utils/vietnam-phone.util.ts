/**
 * Vietnamese phone number validation and normalization utility.
 * Supports standard Vietnamese mobile formats:
 * - 09x, 08x, 07x, 05x, 03x
 * Canonical storage format: E.164 (+84...)
 * Local display format: 0...
 */

const VIETNAM_PHONE_REGEX = /^(?:\+84|84|0)(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])([0-9]{7})$/;

export function isValidVietnamPhone(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  const cleaned = input.replace(/[\s\-\.\(\)]/g, '');
  return VIETNAM_PHONE_REGEX.test(cleaned);
}

export function normalizeVietnamPhone(input: string): { e164: string; display: string } | null {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.replace(/[\s\-\.\(\)]/g, '');
  const match = cleaned.match(VIETNAM_PHONE_REGEX);
  if (!match) return null;

  const prefix = match[1];
  const suffix = match[2];

  return {
    e164: `+84${prefix}${suffix}`,
    display: `0${prefix}${suffix}`,
  };
}
