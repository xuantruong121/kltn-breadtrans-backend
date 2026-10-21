/** Explicit classification for an image-search provider failure, attached to
 * the existing NestJS exception thrown by each provider (never replacing the
 * exception class, so any existing `instanceof` handling keeps working).
 * Lets callers distinguish "nothing matched" from "the provider itself is
 * unavailable" instead of collapsing everything into one generic message. */
export type ImageSearchErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_BLOCKED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_TRANSIENT'
  | 'PROVIDER_AUTH_FAILURE'
  | 'PROVIDER_NO_RESULTS';

export function withImageSearchErrorCode<T extends Error>(
  error: T,
  code: ImageSearchErrorCode,
): T {
  (
    error as T & { imageSearchErrorCode: ImageSearchErrorCode }
  ).imageSearchErrorCode = code;
  return error;
}

export function imageSearchErrorCode(
  error: unknown,
): ImageSearchErrorCode | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { imageSearchErrorCode?: unknown })
    .imageSearchErrorCode;
  return typeof code === 'string' ? (code as ImageSearchErrorCode) : null;
}

/** HTML/challenge bodies (Cloudflare "Just a moment...", WAF block pages)
 * must never be parsed as the provider's JSON contract and must never be
 * classified as an ordinary rate limit — they mean the provider blocked this
 * request/IP outright. */
export function looksLikeHtmlChallenge(bodyText: string): boolean {
  const head = bodyText.slice(0, 400).toLowerCase();
  return (
    head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('cloudflare') ||
    head.includes('just a moment')
  );
}

/** Standard classification for a non-ok HTTP response from a search
 * provider, given its status and raw body text (read once, before trying to
 * parse JSON). */
export function classifySearchHttpFailure(
  status: number,
  bodyText: string,
): ImageSearchErrorCode {
  if (status === 429 && looksLikeHtmlChallenge(bodyText))
    return 'PROVIDER_BLOCKED';
  if (status === 429) return 'PROVIDER_RATE_LIMITED';
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_FAILURE';
  if (status >= 500) return 'PROVIDER_TRANSIENT';
  return 'PROVIDER_TRANSIENT';
}
