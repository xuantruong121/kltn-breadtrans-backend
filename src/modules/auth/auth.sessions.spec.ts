/* eslint-disable @typescript-eslint/require-await */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuthController } from './auth.controller';
import { getJwtSecret } from './auth.constants';
import { AuthService } from './auth.service';
import {
  AuthSessionStore,
  MAX_SESSIONS_PER_USER,
  ROTATION_GRACE_MS,
  hashToken,
} from './session-store';

/** In-memory Redis with the string and set commands the session store uses. */
function memoryRedis() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    store,
    sets,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    }),
    mget: jest.fn(async (keys: string[]) =>
      keys.map((k) => store.get(k) ?? null),
    ),
    sadd: jest.fn(async (k: string, ...m: string[]) => {
      const s = sets.get(k) ?? new Set<string>();
      m.forEach((x) => s.add(x));
      sets.set(k, s);
      return m.length;
    }),
    srem: jest.fn(async (k: string, ...m: string[]) => {
      m.forEach((x) => sets.get(k)?.delete(x));
      return m.length;
    }),
    smembers: jest.fn(async (k: string) => [...(sets.get(k) ?? [])]),
    expire: jest.fn(async () => 1),
    ttl: jest.fn(async () => -2),
    incr: jest.fn(async () => 1),
  };
}

describe('AuthSessionStore', () => {
  it('stores only the hash of the refresh token', async () => {
    const redis = memoryRedis();
    const store = new AuthSessionStore(redis as any);
    await store.create(1, 'd1', 'secret-refresh', { remember: true });
    const raw = [...redis.store.values()].join('|');
    expect(raw).not.toContain('secret-refresh');
    expect((await store.get(1, 'd1'))?.hash).toBe(hashToken('secret-refresh'));
    expect(await redis.smembers('auth:sessions:1')).toEqual(['d1']);
  });

  it('keeps at most 10 devices, dropping the least recently used', async () => {
    const store = new AuthSessionStore(memoryRedis() as any);
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 2; i += 1)
      await store.create(1, `d${i}`, `t${i}`, { remember: true }, 1000 + i);
    const ids = (await store.list(1)).map((s) => s.deviceId).sort();
    expect(ids).toHaveLength(MAX_SESSIONS_PER_USER);
    expect(ids).not.toContain('d0');
    expect(ids).not.toContain('d1');
  });

  it('rotates the current token, renews the previous one only within the grace window, and revokes on reuse', async () => {
    const redis = memoryRedis();
    const store = new AuthSessionStore(redis as any);
    await store.create(1, 'd1', 'A', { remember: false }, 0);
    expect((await store.rotate(1, 'd1', 'A', 'B', 10)).kind).toBe('ROTATED');
    expect((await store.rotate(1, 'd1', 'A', 'C', 20)).kind).toBe('GRACE');
    // Still the token from the real rotation.
    expect((await store.get(1, 'd1'))?.hash).toBe(hashToken('B'));
    expect(
      (await store.rotate(1, 'd1', 'A', 'D', 20 + ROTATION_GRACE_MS)).kind,
    ).toBe('REUSED');
    expect(await store.get(1, 'd1')).toBeNull();
    expect(redis.store.has('user:1:device:d1:logged_out_at')).toBe(true);
    expect((await store.rotate(1, 'd1', 'B', 'E', 30)).kind).toBe('MISSING');
  });

  it('revokes every device but the one kept', async () => {
    const store = new AuthSessionStore(memoryRedis() as any);
    await store.create(1, 'a', 'x', { remember: true });
    await store.create(1, 'b', 'y', { remember: true });
    await store.create(1, 'c', 'z', { remember: true });
    expect(await store.revokeAll(1, 'b')).toBe(2);
    expect((await store.list(1)).map((s) => s.deviceId)).toEqual(['b']);
  });
});

describe('refresh tokens, cookies and revocation', () => {
  const user = {
    id: 5,
    email: 'learner@example.com',
    role: 'STUDENT',
    password: '',
    profile: null,
  };
  let redis: ReturnType<typeof memoryRedis>;
  let service: AuthService;
  let controller: AuthController;
  const jwt = new JwtService({ secret: getJwtSecret() });

  const res = () => ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  });
  const req = (cookie?: string, headers: Record<string, string> = {}) =>
    ({
      headers: {
        'x-requested-with': 'breadtrans',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
    }) as any;
  const cookieValue = (r: ReturnType<typeof res>) =>
    r.cookie.mock.calls.at(-1)?.[1] as string;

  beforeEach(async () => {
    user.password = await bcrypt.hash('mot cum tu de nho', 4);
    redis = memoryRedis();
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async () => user),
      },
    };
    service = new AuthService(prisma, jwt, redis as any, {} as any);
    controller = new AuthController(service);
  });

  const login = async (rememberMe = false) => {
    const r = res();
    const body = await controller.login(
      { email: user.email, password: 'mot cum tu de nho', rememberMe },
      req(),
      r as any,
    );
    return { body, r, token: cookieValue(r) };
  };

  it('login puts the refresh token in an HttpOnly Strict cookie, never in the JSON', async () => {
    const { body, r, token } = await login(true);
    expect(body).not.toHaveProperty('refresh_token');
    expect(body).toHaveProperty('access_token');
    expect(r.cookie).toHaveBeenCalledWith(
      'bt_rt',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/auth',
        maxAge: 30 * 24 * 3600 * 1000,
      }),
    );
    // Not remembered: a session cookie without maxAge.
    const short = await login(false);
    expect(short.r.cookie.mock.calls[0][2]).not.toHaveProperty('maxAge');
    // Signed with the refresh secret: the access secret cannot verify it.
    expect(() => jwt.verify(token)).toThrow();
  });

  it('refresh needs the CSRF header and an allowed origin', async () => {
    const { token } = await login();
    await expect(
      controller.refreshTokens(
        req(`bt_rt=${token}`, { 'x-requested-with': '' }),
        res() as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.refreshTokens(
        req(`bt_rt=${token}`, { origin: 'https://evil.example' }),
        res() as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refresh rotates the cookie, a parallel request with the old one gets no new cookie, a late reuse ends the session', async () => {
    const { token } = await login();
    const r1 = res();
    const first = await controller.refreshTokens(
      req(`bt_rt=${token}`),
      r1 as any,
    );
    expect(first).toHaveProperty('access_token');
    const next = cookieValue(r1);
    expect(next).toBeTruthy();
    expect(next).not.toBe(token);

    const r2 = res();
    await controller.refreshTokens(req(`bt_rt=${token}`), r2 as any);
    expect(r2.cookie).not.toHaveBeenCalled();

    // Past the grace window the old token is a reuse.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    const r3 = res();
    await expect(
      controller.refreshTokens(req(`bt_rt=${token}`), r3 as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(r3.clearCookie).toHaveBeenCalled();
    await expect(
      controller.refreshTokens(req(`bt_rt=${next}`), res() as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    jest.restoreAllMocks();
  });

  it('refresh without a cookie is refused and clears the cookie', async () => {
    const r = res();
    await expect(
      controller.refreshTokens(req(), r as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(r.clearCookie).toHaveBeenCalledWith(
      'bt_rt',
      expect.objectContaining({ path: '/auth' }),
    );
  });

  it('changing the password signs out every other device', async () => {
    await login();
    await login();
    const sessions = await service.sessions.list(user.id);
    expect(sessions).toHaveLength(2);
    const keep = sessions[0].deviceId;
    const out = await service.changePassword(
      user.id,
      'mot cum tu de nho',
      'mot cum tu moi hon nua',
      keep,
    );
    expect(out.signedOutDevices).toBe(1);
    expect(
      (await service.sessions.list(user.id)).map((s) => s.deviceId),
    ).toEqual([keep]);
  });

  it('lists the devices with the current one marked and revokes the others', async () => {
    await login();
    await login();
    const [a] = await service.sessions.list(user.id);
    const list = await service.listSessions(user.id, a.deviceId);
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list[0].userAgent).toContain('Chrome');
    expect(await service.revokeOtherSessions(user.id, a.deviceId)).toEqual({
      revoked: 1,
    });
  });
});
