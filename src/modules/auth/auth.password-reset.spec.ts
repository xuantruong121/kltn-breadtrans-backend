/* eslint-disable @typescript-eslint/require-await */
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';

/** Minimal in-memory Redis covering the commands the reset flow uses. */
function memoryRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    getdel: jest.fn(async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    }),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    }),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    }),
  };
}

describe('AuthService password reset', () => {
  const user = { id: 7, email: 'learner@example.com', password: 'old-hash' };
  let redis: ReturnType<typeof memoryRedis>;
  let prisma: any;
  let email: { sendPasswordResetEmail: jest.Mock };
  let service: AuthService;
  const tokenFrom = () =>
    /token=([0-9a-f]+)/.exec(
      email.sendPasswordResetEmail.mock.calls.at(-1)?.[1] ?? '',
    )?.[1] ?? '';

  beforeEach(() => {
    redis = memoryRedis();
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.email === user.email ? user : null,
        ),
        update: jest.fn(async () => user),
      },
    };
    email = { sendPasswordResetEmail: jest.fn(async () => undefined) };
    service = new AuthService(prisma, {} as any, redis as any, email as any);
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    const unknown = await service.requestPasswordReset('nobody@example.com');
    const known = await service.requestPasswordReset(user.email);
    expect(unknown).toEqual(known);
    expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('resets the password with the emailed token, once, and revokes sessions', async () => {
    redis.store.set(`user:${user.id}:device:phone`, 'refresh');
    await service.requestPasswordReset(user.email);
    const token = tokenFrom();
    expect(token).toHaveLength(64);
    expect([...redis.store.keys()].some((k) => k.includes(token))).toBe(false); // only the hash is stored

    await service.resetPassword(token, 'New-Password-1!');
    const saved = prisma.user.update.mock.calls[0][0].data.password;
    expect(await bcrypt.compare('New-Password-1!', saved)).toBe(true);
    expect(redis.store.has(`user:${user.id}:device:phone`)).toBe(false);

    await expect(service.resetPassword(token, 'Another-1!')).rejects.toThrow(
      'không hợp lệ',
    );
  });

  it('rate-limits repeated requests for 60 seconds without revealing it', async () => {
    const first = await service.requestPasswordReset(user.email);
    const second = await service.requestPasswordReset(user.email);
    expect(second).toEqual(first);
    expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('a newer link invalidates the older one', async () => {
    await service.requestPasswordReset(user.email);
    const older = tokenFrom();
    redis.store.delete(`auth:password-reset:cooldown:${user.email}`);
    await service.requestPasswordReset(user.email);
    const newer = tokenFrom();
    await expect(
      service.resetPassword(older, 'X-Password-1!'),
    ).rejects.toThrow();
    await expect(
      service.resetPassword(newer, 'Y-Password-1!'),
    ).resolves.toBeDefined();
  });

  it('refuses an unknown token', async () => {
    await expect(
      service.resetPassword('f'.repeat(64), 'Z-Password-1!'),
    ).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
