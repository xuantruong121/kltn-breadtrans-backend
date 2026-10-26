/**
 * C3-INC-001 negative tests. Nothing here connects to a protected service:
 * the only real connection attempts go to the refusing sentinel on port 9.
 */
import { PrismaClient } from '@prisma/client';

import {
  assessDatabaseIdentity,
  assessDatabaseUrl,
  assessRedisIdentity,
  assessRedisUrl,
  DB_VERIFIED_ENV,
  PROTECTED_CLUSTER_IDENTITIES,
  SENTINEL_DATABASE_URL,
  SENTINEL_REDIS_URL,
  verificationToken,
} from './test-target-guard';
import { verifyDatabaseTarget, verifyRedisTarget } from './target-identity';

const KLTN_DB = 'postgresql://user:secret@localhost:5432/kltn_db';
const DISPOSABLE = 'postgresql://c3:x@127.0.0.1:5450/c3_clone';

describe('assessDatabaseUrl (static, before any connection)', () => {
  it.each([
    ['missing', undefined, /not set/],
    ['empty', '  ', /not set/],
    ['not a URL', 'kltn_db', /not a valid URL/],
    ['kltn_db on localhost', KLTN_DB, /kltn_db is protected/],
    [
      'kltn_db on any other host',
      'postgresql://u:p@10.0.0.5:6000/kltn_db',
      /protected/,
    ],
    [
      'kltn_db in another case',
      'postgresql://u:p@db.example:5432/KLTN_DB',
      /protected/,
    ],
    [
      'kltn_db percent-encoded',
      'postgresql://u:p@h:5432/%6Bltn_db',
      /protected/,
    ],
    [
      'kltn_shadow',
      'postgresql://u:p@localhost:5433/kltn_shadow',
      /kltn_shadow is protected/,
    ],
    [
      'another db on the protected 5432 container',
      'postgresql://u:p@localhost:5432/kltn_test_db',
      /protected PostgreSQL container/,
    ],
    [
      'the shadow container via 127.0.0.1',
      'postgresql://u:p@127.0.0.1:5433/scratch',
      /protected PostgreSQL container/,
    ],
    [
      'the default port on localhost',
      'postgresql://u:p@localhost/scratch',
      /protected PostgreSQL container/,
    ],
    [
      'host.docker.internal:5432',
      'postgresql://u:p@host.docker.internal:5432/scratch',
      /protected/,
    ],
    ['a non-postgres protocol', 'mysql://u:p@h:3306/x', /unsupported protocol/],
  ])('refuses %s', (_label, url, reason) => {
    const verdict = assessDatabaseUrl(url);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(reason);
  });

  it('accepts a disposable database on a non-protected port', () => {
    expect(assessDatabaseUrl(DISPOSABLE)).toEqual({ ok: true });
  });
});

describe('assessDatabaseIdentity (what the connection actually reached)', () => {
  it('refuses a harmless-looking URL whose connection reached a protected cluster (host alias)', () => {
    // e.g. postgresql://u:p@192.168.1.20:5432/kltn_test_db reaching kltn-postgres
    expect(
      assessDatabaseIdentity(
        {
          database: 'kltn_test_db',
          systemIdentifier: PROTECTED_CLUSTER_IDENTITIES[0],
        },
        PROTECTED_CLUSTER_IDENTITIES,
      ),
    ).toEqual({
      ok: false,
      reason: `connection reached protected cluster ${PROTECTED_CLUSTER_IDENTITIES[0]}`,
    });
    expect(
      assessDatabaseIdentity(
        {
          database: 'scratch',
          systemIdentifier: PROTECTED_CLUSTER_IDENTITIES[1],
        },
        PROTECTED_CLUSTER_IDENTITIES,
      ).ok,
    ).toBe(false);
  });

  it('refuses a protected database name on an unknown cluster, and an unreadable identity', () => {
    expect(
      assessDatabaseIdentity({ database: 'kltn_db', systemIdentifier: '1' }, [])
        .ok,
    ).toBe(false);
    expect(
      assessDatabaseIdentity({ database: 'x', systemIdentifier: '' }, []),
    ).toEqual({ ok: false, reason: 'cluster identity could not be read' });
  });

  it('accepts a disposable cluster', () => {
    expect(
      assessDatabaseIdentity(
        { database: 'c3_clone', systemIdentifier: '7700830945193414690' },
        PROTECTED_CLUSTER_IDENTITIES,
      ),
    ).toEqual({ ok: true });
  });
});

describe('Redis isolation', () => {
  it.each([
    ['missing', undefined, /not set/],
    ['the shared port', 'redis://127.0.0.1:6379', /shared Redis/],
    ['the default port', 'redis://localhost', /shared Redis/],
    ['a non-redis protocol', 'http://localhost:6391', /unsupported protocol/],
  ])('refuses %s', (_label, url, reason) => {
    const verdict = assessRedisUrl(url);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(reason);
  });

  it('refuses an alias that reaches the shared server (same run_id), and an unreadable one', () => {
    expect(assessRedisIdentity('abc', 'abc')).toEqual({
      ok: false,
      reason: 'connection reached the shared Redis on 6379',
    });
    expect(assessRedisIdentity(null, 'abc').ok).toBe(false);
    expect(assessRedisIdentity('def', 'abc')).toEqual({ ok: true });
  });
});

describe('verifyDatabaseTarget / verifyRedisTarget fail closed', () => {
  it('refuses missing and protected targets without connecting', async () => {
    await expect(verifyDatabaseTarget(undefined, [])).resolves.toMatchObject({
      ok: false,
    });
    await expect(verifyDatabaseTarget(KLTN_DB, [])).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/protected/),
    });
  });

  it('refuses when the identity cannot be verified', async () => {
    const verdict = await verifyDatabaseTarget(
      'postgresql://u:p@127.0.0.1:9/unreachable_scratch',
      [],
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/could not be verified/);
  }, 20_000);

  it('refuses an unreachable Redis', async () => {
    await expect(
      verifyRedisTarget('redis://127.0.0.1:9', 'redis://127.0.0.1:9'),
    ).resolves.toEqual({
      ok: false,
      reason: 'Redis identity could not be read',
    });
  });
});

describe('worker environment (jest-setup-isolation)', () => {
  it('replaces every ordinary target with a sentinel when nothing was verified', () => {
    expect(
      process.env.TEST_DATABASE_URL ? 'skip' : process.env.DATABASE_URL,
    ).toBe(process.env.TEST_DATABASE_URL ? 'skip' : SENTINEL_DATABASE_URL);
    expect(process.env.SHADOW_DATABASE_URL).toBe(SENTINEL_DATABASE_URL);
    if (!process.env.TEST_REDIS_URL)
      expect(process.env.REDIS_URL).toBe(
        new URL(SENTINEL_REDIS_URL).toString(),
      );
  });

  const rerunSetup = (env: Record<string, string | undefined>) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env))
      if (v === undefined) delete process.env[k];
    jest.isolateModules(() => {
      // The setup file has side effects only; it must re-run per case.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./jest-setup-isolation');
    });
    const result = {
      DATABASE_URL: process.env.DATABASE_URL,
      SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      REDIS_PORT: process.env.REDIS_PORT,
    };
    process.env = saved;
    return result;
  };

  it('overrides a shell DATABASE_URL/REDIS_URL that point at the protected services', () => {
    const out = rerunSetup({
      DATABASE_URL: KLTN_DB,
      SHADOW_DATABASE_URL: 'postgresql://u:p@localhost:5433/kltn_shadow',
      REDIS_URL: 'redis://localhost:6379',
      TEST_DATABASE_URL: undefined,
      TEST_REDIS_URL: undefined,
    });
    expect(out.DATABASE_URL).toBe(SENTINEL_DATABASE_URL);
    expect(out.SHADOW_DATABASE_URL).toBe(SENTINEL_DATABASE_URL);
    expect(out.REDIS_PORT).toBe('9');
  });

  it('does not use a TEST_DATABASE_URL the global setup did not verify', () => {
    const out = rerunSetup({
      TEST_DATABASE_URL: DISPOSABLE,
      [DB_VERIFIED_ENV]: undefined,
    });
    expect(out.DATABASE_URL).toBe(SENTINEL_DATABASE_URL);
    const forged = rerunSetup({
      TEST_DATABASE_URL: DISPOSABLE,
      [DB_VERIFIED_ENV]: verificationToken('postgresql://other'),
    });
    expect(forged.DATABASE_URL).toBe(SENTINEL_DATABASE_URL);
  });

  it('uses TEST_DATABASE_URL only with the matching verification', () => {
    const out = rerunSetup({
      TEST_DATABASE_URL: DISPOSABLE,
      [DB_VERIFIED_ENV]: verificationToken(DISPOSABLE),
    });
    expect(out.DATABASE_URL).toBe(DISPOSABLE);
  });

  it('a Prisma client created with no URL cannot fall back to .env: it reaches only the sentinel', async () => {
    if (process.env.TEST_DATABASE_URL) return; // a verified target is in use
    const client = new PrismaClient({ log: [] });
    try {
      await expect(client.$queryRawUnsafe('SELECT 1')).rejects.toThrow(
        /127\.0\.0\.1:9/,
      );
    } finally {
      await client.$disconnect();
    }
  }, 30_000);
});
