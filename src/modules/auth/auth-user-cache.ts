/**
 * The account fields every authenticated request checks, kept for 60 s.
 *
 * Reading them from the database on every request was a fifth of the API's CPU
 * under load (capacity run 2026-11-09). Whatever changes these fields calls
 * forgetAuthUser(id), so a password change or an admin's role change applies on
 * the next request in this process; anything else (another API process, a
 * direct database edit) applies within 60 s. Revoked tokens and ended device
 * sessions do not depend on this: they are checked in Redis on every request.
 */
export type AuthUser = {
  id: number;
  email: string;
  role: string;
  mustChangePassword: boolean;
};

export const AUTH_USER_TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;
const cache = new Map<number, { at: number; user: AuthUser | null }>();

/** The cached account, or undefined when it must be read again. */
export function cachedAuthUser(id: number): AuthUser | null | undefined {
  const hit = cache.get(id);
  if (!hit) return undefined;
  if (Date.now() - hit.at > AUTH_USER_TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return hit.user;
}

export function rememberAuthUser(id: number, user: AuthUser | null) {
  cache.delete(id);
  if (cache.size >= MAX_ENTRIES)
    cache.delete(cache.keys().next().value as number);
  cache.set(id, { at: Date.now(), user });
}

/** Call after changing an account's role, password flag, or deleting it. */
export function forgetAuthUser(id: number) {
  cache.delete(id);
}

/** Tests only. */
export function clearAuthUserCache() {
  cache.clear();
}
