import { PayosProvider } from './payos.provider';

describe('PayosProvider', () => {
  const keys = [
    'PAYOS_CLIENT_ID',
    'PAYOS_API_KEY',
    'PAYOS_CHECKSUM_KEY',
  ] as const;
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('requires all three server-side credentials before enabling PayOS', () => {
    const provider = new PayosProvider();
    for (const key of keys) delete process.env[key];
    expect(provider.isConfigured()).toBe(false);

    process.env.PAYOS_CLIENT_ID = 'client';
    process.env.PAYOS_API_KEY = 'api';
    process.env.PAYOS_CHECKSUM_KEY = 'checksum';
    expect(provider.isConfigured()).toBe(true);
  });
});
