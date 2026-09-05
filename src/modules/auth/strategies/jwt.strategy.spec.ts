import { Test, TestingModule } from '@nestjs/testing';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';

describe('JwtStrategy security checks', () => {
  let strategy: JwtStrategy;
  let redis: { get: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
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
});
