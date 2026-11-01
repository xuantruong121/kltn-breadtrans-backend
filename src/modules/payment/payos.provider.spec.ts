import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PayOS } from '@payos/node';
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

  // Runs the real SDK: `verify` only computes a signature, so nothing leaves
  // the process.
  describe('verifyWebhook', () => {
    const data = {
      orderCode: 123456,
      amount: 69000,
      currency: 'VND',
      code: '00',
      paymentLinkId: 'link-1',
    };
    const sign = (value: Record<string, unknown>) =>
      new PayOS({
        clientId: 'client',
        apiKey: 'api',
        checksumKey: 'checksum',
      }).crypto.createSignatureFromObj(value, 'checksum');

    beforeEach(() => {
      process.env.PAYOS_CLIENT_ID = 'client';
      process.env.PAYOS_API_KEY = 'api';
      process.env.PAYOS_CHECKSUM_KEY = 'checksum';
    });

    it('returns the data of a correctly signed webhook', async () => {
      const signature = await sign(data);

      await expect(
        new PayosProvider().verifyWebhook({ data, signature }),
      ).resolves.toEqual(data);
    });

    it.each([
      ['a wrong signature', { data, signature: 'not-the-signature' }],
      ['no signature', { data }],
      ['no data', { signature: 'not-the-signature' }],
      ['an empty object', {}],
      ['a null payload', null],
      ['an undefined payload', undefined],
      ['a string payload', 'webhook'],
      ['string data', { data: 'webhook', signature: 'not-the-signature' }],
    ])('rejects %s as a bad request', async (_case, payload) => {
      await expect(
        new PayosProvider().verifyWebhook(payload),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps reporting a missing configuration as unavailable', async () => {
      delete process.env.PAYOS_CHECKSUM_KEY;

      await expect(
        new PayosProvider().verifyWebhook({ data, signature: 'x' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
