import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AuthService } from './auth.service';
import { AcceptConsentDto, RegisterDto } from './dto/auth.dto';
import { LEGAL_VERSION, consentRequired, consentRows } from './legal-consent';

describe('legal consent (owner 2026-11-16)', () => {
  it('requires both documents at the current version', () => {
    expect(consentRequired([])).toBe(true);
    expect(
      consentRequired([{ document: 'TERMS', version: LEGAL_VERSION }]),
    ).toBe(true);
    expect(
      consentRequired([
        { document: 'TERMS', version: LEGAL_VERSION },
        { document: 'PRIVACY', version: '2020-01-01' },
      ]),
    ).toBe(true);
    expect(
      consentRequired([
        { document: 'TERMS', version: LEGAL_VERSION },
        { document: 'PRIVACY', version: LEGAL_VERSION },
      ]),
    ).toBe(false);
  });

  it('records one row per document with method, IP and a clipped User-Agent', () => {
    const rows = consentRows('PROMPT', {
      ip: '203.0.113.9',
      userAgent: 'x'.repeat(400),
    });
    expect(rows.map((r) => r.document)).toEqual(['TERMS', 'PRIVACY']);
    expect(rows[0]).toMatchObject({
      version: LEGAL_VERSION,
      method: 'PROMPT',
      ip: '203.0.113.9',
    });
    expect(rows[0].userAgent).toHaveLength(255);
    expect(consentRows('EMAIL_SIGNUP')[0]).toMatchObject({
      ip: null,
      userAgent: null,
    });
  });

  it('sign-up is refused unless the box was ticked (true, not a truthy string)', async () => {
    const base = {
      email: 'a@b.vn',
      password: 'mot cum tu de nho',
      fullName: 'A',
    };
    const errors = async (extra: Record<string, unknown>) =>
      (await validate(plainToInstance(RegisterDto, { ...base, ...extra })))
        .filter((e) => e.property === 'acceptTerms')
        .flatMap((e) => Object.values(e.constraints ?? {}));
    expect(await errors({})).toEqual([
      'Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật để tạo tài khoản.',
    ]);
    expect(await errors({ acceptTerms: false })).toHaveLength(1);
    expect(await errors({ acceptTerms: 'true' })).toHaveLength(1);
    expect(await errors({ acceptTerms: true })).toEqual([]);
    expect(
      await validate(plainToInstance(AcceptConsentDto, { acceptTerms: false })),
    ).toHaveLength(1);
  });

  describe('accepting after sign-up (audit A15)', () => {
    function setup(seenInsideLock: { document: string; version: string }[]) {
      const tx: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        userConsent: {
          findMany: jest.fn().mockResolvedValue(seenInsideLock),
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      };
      const prisma: any = {
        userConsent: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
      };
      const service = new AuthService(prisma, {} as any, {} as any, {} as any);
      return { service, prisma, tx };
    }

    it('two accepts at once record the documents once', async () => {
      // The other request wrote both rows while this one waited on the lock.
      const { service, prisma, tx } = setup([
        { document: 'TERMS', version: LEGAL_VERSION },
        { document: 'PRIVACY', version: LEGAL_VERSION },
      ]);

      await expect(service.acceptConsent(7)).resolves.toEqual({
        consentRequired: false,
        version: LEGAL_VERSION,
      });
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(prisma.userConsent.createMany).not.toHaveBeenCalled();
      expect(tx.userConsent.createMany).not.toHaveBeenCalled();
    });

    it('the first accept records both documents for the user', async () => {
      const { service, tx } = setup([]);

      await service.acceptConsent(7, { ip: '203.0.113.9' });

      const rows = tx.userConsent.createMany.mock.calls[0][0].data;
      expect(rows.map((r: { document: string }) => r.document)).toEqual([
        'TERMS',
        'PRIVACY',
      ]);
      expect(rows[0]).toMatchObject({ userId: 7, method: 'PROMPT' });
    });
  });

  describe('Google redirect sign-in (code, then exchange)', () => {
    const profile = {
      providerId: 'g-9',
      email: 'new@gmail.com',
      fullName: 'New',
      avatar: null,
    };
    function setup() {
      const store = new Map<string, string>();
      const redis: any = {
        set: jest.fn((k: string, v: string) =>
          Promise.resolve(store.set(k, v)),
        ),
        getdel: jest.fn((k: string) => {
          const v = store.get(k) ?? null;
          store.delete(k);
          return Promise.resolve(v);
        }),
      };
      const prisma: any = {
        authAccount: { findUnique: jest.fn().mockResolvedValue(null) },
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
          create: jest.fn((args: any) =>
            Promise.resolve({
              id: 7,
              email: args.data.email,
              role: 'STUDENT',
              profile: null,
            }),
          ),
        },
        userConsent: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new AuthService(
        prisma,
        { sign: jest.fn(() => 'jwt') } as any,
        redis,
        {} as any,
      );
      (service as any).sessions = { create: jest.fn() };
      return { service, prisma, store };
    }

    it('creates nothing at the callback; the exchange needs the consent, and the code survives a refusal', async () => {
      const { service, prisma } = setup();
      const code = await service.createGoogleLoginCode(profile, 'dev-1');
      expect(prisma.user.create).not.toHaveBeenCalled();

      await expect(
        service.exchangeGoogleLoginCode(code),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();

      const res = await service.exchangeGoogleLoginCode(code, {}, true);
      expect(res.user.id).toBe(7);
      expect(
        prisma.user.create.mock.calls[0][0].data.consents.create[0],
      ).toMatchObject({
        document: 'TERMS',
        method: 'GOOGLE_SIGNUP',
      });
    });
  });
});
