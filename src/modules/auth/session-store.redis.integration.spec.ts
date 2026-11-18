import IORedis from 'ioredis';
import { describeWithIsolatedRedis } from '../../../test/safety/isolated';
import { AuthSessionStore } from './session-store';

/**
 * Refresh rotation against a real Redis (audit A2/A4, 2026-11-18). rotate used
 * to read the session, then write it back: two tabs refreshing at once both
 * rotated and one was logged out on its next refresh, and a revokeAll between
 * the read and the write (a password reset) was undone by the write.
 */
describeWithIsolatedRedis('AuthSessionStore.rotate on real Redis', () => {
  let redis: IORedis;
  const base = 900_000_000 + Math.floor(Math.random() * 1_000_000);
  let seq = 0;
  const usedUsers: number[] = [];

  const nextUser = () => {
    const id = base + seq++;
    usedUsers.push(id);
    return id;
  };

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: null,
    });
  });

  afterAll(async () => {
    for (const id of usedUsers) {
      const keys = await redis.keys(`*:${id}:*`);
      const more = await redis.keys(`*:${id}`);
      if (keys.length + more.length) await redis.del(...keys, ...more);
    }
    await redis.quit();
  });

  it('two refreshes with the same token: one rotates, the other renews in the grace window', async () => {
    const userId = nextUser();
    const store = new AuthSessionStore(redis);
    await store.create(userId, 'dev-a', 'token-0', { remember: true });

    const [first, second] = await Promise.all([
      store.rotate(userId, 'dev-a', 'token-0', 'token-1'),
      store.rotate(userId, 'dev-a', 'token-0', 'token-2'),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(['GRACE', 'ROTATED']);
    const winner = first.kind === 'ROTATED' ? 'token-1' : 'token-2';
    // The token the browser kept still renews afterwards.
    const later = await store.rotate(userId, 'dev-a', winner, 'token-3');
    expect(later.kind).toBe('ROTATED');
  });

  it('a revokeAll between the read and the write is not undone', async () => {
    const userId = nextUser();
    const plain = new AuthSessionStore(redis);
    await plain.create(userId, 'dev-a', 'token-0', { remember: true });

    // The first write rotate sends (the Lua step, or the old SET) waits until
    // a password reset has revoked every session of the account.
    let hooked = false;
    const racing = new Proxy(redis, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (
          (prop === 'eval' || prop === 'set') &&
          typeof value === 'function'
        ) {
          return async (...args: unknown[]) => {
            const touchesSession =
              prop === 'eval' ||
              String(args[0]).startsWith(`auth:session:${userId}:`);
            if (!hooked && touchesSession) {
              hooked = true;
              await plain.revokeAll(userId);
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });

    const result = await new AuthSessionStore(racing).rotate(
      userId,
      'dev-a',
      'token-0',
      'token-1',
    );

    expect(hooked).toBe(true);
    expect(result.kind).toBe('MISSING');
    expect(await plain.get(userId, 'dev-a')).toBeNull();
    expect(await plain.list(userId)).toEqual([]);
  });
});
