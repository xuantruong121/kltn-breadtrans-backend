import { createHash, timingSafeEqual } from 'crypto';
import type Redis from 'ioredis';

import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';

/** At most this many signed-in devices per account; the least recently used goes first. */
export const MAX_SESSIONS_PER_USER = 10;
/** A refresh token just rotated out still renews (without rotating) for this long. */
export const ROTATION_GRACE_MS = 30_000;
/** Access tokens issued before a revocation stay refused this long (> access TTL). */
const LOGGED_OUT_MARK_SECONDS = 60 * 60;

export type StoredSession = {
  deviceId: string;
  /** sha256 of the current refresh token: the token itself is never stored. */
  hash: string;
  prevHash: string | null;
  prevUntil: number;
  createdAt: number;
  lastUsedAt: number;
  userAgent: string | null;
  remember: boolean;
};

export type RotationResult =
  | { kind: 'ROTATED'; session: StoredSession }
  | { kind: 'GRACE'; session: StoredSession }
  | { kind: 'REUSED' }
  | { kind: 'MISSING' };

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const sameHash = (a: string | null | undefined, b: string) =>
  !!a &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

const sessionKey = (userId: number, deviceId: string) =>
  `auth:session:${userId}:${deviceId}`;
const setKey = (userId: number) => `auth:sessions:${userId}`;
/** Read by JwtStrategy and the socket gateways: kept in its old shape. */
export const loggedOutKey = (userId: number, deviceId: string) =>
  `user:${userId}:device:${deviceId}:logged_out_at`;
const passwordChangedKey = (userId: number) =>
  `auth:password-changed-at:${userId}`;

/**
 * The compare-and-set of a rotation, in one Redis step (audit A2/A4,
 * 2026-11-18). KEYS: the session, the account's device set. ARGV: the hash
 * the caller presented, the new session JSON, the TTL in seconds, the device
 * id. Returns {1} when it rotated, {0} when the session is gone, or
 * {2, current JSON} when the stored hash is no longer the presented one.
 */
const ROTATE_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then return {0} end
local ok, s = pcall(cjson.decode, cur)
if not ok or type(s) ~= 'table' then return {0} end
if s['hash'] == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  redis.call('SADD', KEYS[2], ARGV[4])
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
  return {1}
end
return {2, cur}
`;

/**
 * Refresh sessions, one per signed-in device (owner 2026-11-14):
 * auth:session:{user}:{device} holds the hashed token and what the devices
 * page shows; auth:sessions:{user} lists the devices, so nothing scans Redis.
 */
export class AuthSessionStore {
  constructor(private readonly redis: Redis) {}

  async get(userId: number, deviceId: string): Promise<StoredSession | null> {
    const raw = await this.redis.get(sessionKey(userId, deviceId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  }

  private async save(userId: number, session: StoredSession) {
    await this.redis.set(
      sessionKey(userId, session.deviceId),
      JSON.stringify(session),
      'EX',
      REFRESH_TOKEN_TTL_SECONDS,
    );
    await this.redis.sadd(setKey(userId), session.deviceId);
    await this.redis.expire(setKey(userId), REFRESH_TOKEN_TTL_SECONDS);
  }

  /** A new sign-in; drops the least recently used device beyond the limit. */
  async create(
    userId: number,
    deviceId: string,
    refreshToken: string,
    meta: { userAgent?: string | null; remember: boolean },
    now = Date.now(),
  ) {
    await this.save(userId, {
      deviceId,
      hash: hashToken(refreshToken),
      prevHash: null,
      prevUntil: 0,
      createdAt: now,
      lastUsedAt: now,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      remember: meta.remember,
    });
    const sessions = await this.list(userId);
    const extra = sessions
      .filter((s) => s.deviceId !== deviceId)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
      .slice(0, Math.max(0, sessions.length - MAX_SESSIONS_PER_USER));
    for (const s of extra) await this.revoke(userId, s.deviceId, now);
  }

  /**
   * Checks a presented refresh token. The current one rotates to `next`. The
   * one just rotated out (another tab's request in flight) renews within
   * ROTATION_GRACE_MS without rotating again. Any other token of the device
   * is a reuse: the session is revoked.
   */
  async rotate(
    userId: number,
    deviceId: string,
    presented: string,
    next: string,
    now = Date.now(),
  ): Promise<RotationResult> {
    let session = await this.get(userId, deviceId);
    if (!session) return { kind: 'MISSING' };
    const presentedHash = hashToken(presented);
    if (sameHash(session.hash, presentedHash)) {
      const rotated: StoredSession = {
        ...session,
        prevHash: session.hash,
        prevUntil: now + ROTATION_GRACE_MS,
        hash: hashToken(next),
        lastUsedAt: now,
      };
      // The write happens only if the stored hash is still the presented one:
      // two tabs refreshing at once give one ROTATED and one GRACE, and a
      // revokeAll that ran meanwhile is not undone.
      const reply = (await this.redis.eval(
        ROTATE_SCRIPT,
        2,
        sessionKey(userId, deviceId),
        setKey(userId),
        presentedHash,
        JSON.stringify(rotated),
        String(REFRESH_TOKEN_TTL_SECONDS),
        deviceId,
      )) as [number, string?];
      if (reply[0] === 1) return { kind: 'ROTATED', session: rotated };
      if (reply[0] === 0 || !reply[1]) return { kind: 'MISSING' };
      try {
        session = JSON.parse(reply[1]) as StoredSession;
      } catch {
        return { kind: 'MISSING' };
      }
    }
    if (sameHash(session.prevHash, presentedHash) && now <= session.prevUntil)
      return { kind: 'GRACE', session };
    await this.revoke(userId, deviceId, now);
    return { kind: 'REUSED' };
  }

  /**
   * A password change: a sign-in that checked the old password before this
   * moment cannot finish (audit A2). Kept as long as a logged-out mark.
   */
  async markPasswordChanged(userId: number, now = Date.now()) {
    await this.redis.set(
      passwordChangedKey(userId),
      String(now),
      'EX',
      LOGGED_OUT_MARK_SECONDS,
    );
  }

  /** True when the password changed at or after `since` (ms). */
  async passwordChangedSince(userId: number, since: number) {
    const raw = await this.redis.get(passwordChangedKey(userId));
    return raw !== null && Number(raw) >= since;
  }

  async list(userId: number): Promise<StoredSession[]> {
    const ids = await this.redis.smembers(setKey(userId));
    if (!ids.length) return [];
    const raws = await this.redis.mget(ids.map((id) => sessionKey(userId, id)));
    const out: StoredSession[] = [];
    const gone: string[] = [];
    raws.forEach((raw, i) => {
      if (!raw) return void gone.push(ids[i]);
      try {
        out.push(JSON.parse(raw) as StoredSession);
      } catch {
        gone.push(ids[i]);
      }
    });
    // Expired sessions leave their id behind; tidy it here.
    if (gone.length) await this.redis.srem(setKey(userId), ...gone);
    return out;
  }

  /** Ends one device: its refresh session and every access token it holds. */
  async revoke(userId: number, deviceId: string, now = Date.now()) {
    await this.redis.del(sessionKey(userId, deviceId));
    await this.redis.srem(setKey(userId), deviceId);
    await this.redis.set(
      loggedOutKey(userId, deviceId),
      String(now),
      'EX',
      LOGGED_OUT_MARK_SECONDS,
    );
  }

  /** Ends every device of the account, or every one but `except`. */
  async revokeAll(userId: number, except?: string, now = Date.now()) {
    const sessions = await this.list(userId);
    for (const s of sessions)
      if (s.deviceId !== except) await this.revoke(userId, s.deviceId, now);
    return sessions.filter((s) => s.deviceId !== except).length;
  }
}
