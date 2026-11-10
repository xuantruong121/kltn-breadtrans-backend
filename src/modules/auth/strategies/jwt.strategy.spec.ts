import { Test, TestingModule } from '@nestjs/testing';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import * as jwt from 'jsonwebtoken';
import { getJwtSecret, getJwtVerificationKey } from '../auth.constants';
import { clearAuthUserCache } from '../auth-user-cache';
import { PrismaService } from '../../../prisma/prisma.service';

describe('JwtStrategy security checks', () => {
  let strategy: JwtStrategy;
  let redis: { get: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    clearAuthUserCache();
    redis = { get: jest.fn().mockResolvedValue(null) };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          email: 'student@example.com',
          role: 'STUDENT',
        }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: getRedisConnectionToken('default'), useValue: redis },
      ],
    }).compile();
    strategy = module.get(JwtStrategy);
  });

  it('verifies with a secret KeyObject built once, accepting the same tokens', () => {
    const key = getJwtVerificationKey();
    expect(key.type).toBe('secret');
    expect(getJwtVerificationKey()).toBe(key);
    const token = jwt.sign({ sub: 1 }, getJwtSecret(), { algorithm: 'HS256' });
    expect((jwt.verify(token, key) as jwt.JwtPayload).sub).toBe(1);
    const forged = jwt.sign({ sub: 1 }, 'another-secret', {
      algorithm: 'HS256',
    });
    expect(() => jwt.verify(forged, key)).toThrow();
  });

  it('rejects refresh tokens on REST guards', async () => {
    await expect(
      strategy.validate(
        { headers: { authorization: 'Bearer refresh-token' } },
        { sub: 1, type: 'refresh', deviceId: 'device-1' },
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a denylisted access token', async () => {
    const token = 'access-token';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    redis.get.mockImplementation((key: string) =>
      key === `jwt:denylist:${hash}` ? 'revoked' : null,
    );

    await expect(
      strategy.validate(
        { headers: { authorization: `Bearer ${token}` } },
        { sub: 1, type: 'access', deviceId: 'device-1', iat: 100 },
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns the current database role, not the stale JWT role', async () => {
    const result = await strategy.validate(
      { headers: { authorization: 'Bearer access-token' } },
      { sub: 1, role: 'ADMIN', type: 'access', deviceId: 'device-1', iat: 100 },
    );

    expect(result.role).toBe('STUDENT');
    expect(result.deviceId).toBe('device-1');
  });

  describe('account lookup cache (capacity run 2026-11-09)', () => {
    const req = { headers: { authorization: 'Bearer access-token' } };
    const payload = { sub: 1, type: 'access', deviceId: 'device-1', iat: 100 };
    afterEach(() => jest.useRealTimers());

    it('reads the account at most once per 60 s', async () => {
      await strategy.validate(req, payload);
      await strategy.validate(req, payload);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('sees a role change made outside the app after 60 s', async () => {
      jest.useFakeTimers({ now: 2_000_000 });
      await strategy.validate(req, payload);
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'student@example.com',
        role: 'ADMIN',
      });
      jest.setSystemTime(2_000_000 + JwtStrategy.USER_TTL_MS + 1);
      await expect(strategy.validate(req, payload)).resolves.toMatchObject({
        role: 'ADMIN',
      });
    });

    it('still checks the denylist on every request, cached account or not', async () => {
      await strategy.validate(req, payload);
      const hash = crypto
        .createHash('sha256')
        .update('access-token')
        .digest('hex');
      redis.get.mockImplementation((key: string) =>
        key === `jwt:denylist:${hash}` ? 'revoked' : null,
      );
      await expect(strategy.validate(req, payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
