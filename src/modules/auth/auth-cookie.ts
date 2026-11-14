import type { Response } from 'express';

import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';

/**
 * The refresh token travels only in this cookie (owner 2026-11-14): HttpOnly
 * so page scripts never see it, SameSite=Strict so other sites cannot send
 * it, and a Path that only covers the auth routes. Behind the Next.js proxy
 * the browser sees /api/auth, so the path comes from AUTH_COOKIE_PATH.
 */
export const REFRESH_COOKIE = 'bt_rt';

export const refreshCookiePath = () => process.env.AUTH_COOKIE_PATH || '/auth';

const secureCookie = () =>
  process.env.AUTH_COOKIE_SECURE
    ? process.env.AUTH_COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';

export function setRefreshCookie(
  res: Pick<Response, 'cookie'>,
  token: string,
  remember: boolean,
) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'strict',
    path: refreshCookiePath(),
    // Not remembered: a session cookie, gone when the browser closes.
    ...(remember ? { maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 } : {}),
  });
}

export function clearRefreshCookie(res: Pick<Response, 'clearCookie'>) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'strict',
    path: refreshCookiePath(),
  });
}

/** One cookie from a Cookie header; no cookie-parser needed for a single value. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * CSRF guard for the cookie routes: the request must carry our header (a
 * cross-site form cannot set it, and setting it forces a CORS preflight) and
 * come from an allowed Origin when the browser sends one.
 */
export function csrfProblem(headers: Record<string, unknown>): string | null {
  if (headers['x-requested-with'] !== 'breadtrans')
    return 'Thiếu header bảo vệ yêu cầu.';
  const origin = typeof headers.origin === 'string' ? headers.origin : null;
  if (!origin) return null;
  const allowed = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return null;
  if (
    process.env.NODE_ENV !== 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  )
    return null;
  return 'Nguồn yêu cầu không được phép.';
}
