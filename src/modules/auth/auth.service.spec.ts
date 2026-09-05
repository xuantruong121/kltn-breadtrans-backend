import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { createMockContext, MockContext } from '../../prisma/prisma.mock';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { getOtpSecret } from './auth.constants';

jest.mock('bcrypt', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashedPassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthService', () => {
  let service: AuthService;
  let mockCtx: MockContext;
  let module: TestingModule;
  let redisMock: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockCtx = createMockContext();
    redisMock = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };
    module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockCtx.prisma,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
        {
          provide: getRedisConnectionToken('default'),
          useValue: redisMock,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should throw ConflictException if user already exists', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
      } as any);

      await expect(
        service.register({
          email: 'test@example.com',
          password: '123',
          fullName: 'Test',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a new user successfully', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null);

      const hashedPassword = 'hashedPassword';
      // bcrypt functions are already mocked at module level

      const mockCreatedUser = {
        id: 1,
        email: 'test@example.com',
        password: hashedPassword,
        role: Role.STUDENT,
        profile: { fullName: 'Test User' },
      };

      mockCtx.prisma.user.create.mockResolvedValue(mockCreatedUser as any);

      const result = await service.register({
        email: 'test@example.com',
        password: '123',
        fullName: 'Test User',
      });

      expect(result).not.toHaveProperty('password');
      expect(result.email).toEqual('test@example.com');
      expect(mockCtx.prisma.user.create).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should throw UnauthorizedException for invalid email', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login(
          { email: 'invalid@example.com', password: '123' },
          'test-device',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        password: 'hashedPassword',
      } as any);

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.login(
          { email: 'test@example.com', password: 'wrong' },
          'test-device',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return token for valid credentials', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        password: 'hashedPassword',
        role: Role.STUDENT,
      } as any);

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.login(
        {
          email: 'test@example.com',
          password: 'password',
        },
        'test-device',
      );

      expect(result).toHaveProperty('access_token', 'mock-jwt-token');
      expect(result.user).toHaveProperty('email', 'test@example.com');
    });
  });

  describe('generateOtp & verifyOtp', () => {
    it('should generate a 6-digit OTP and store HMAC hash in Redis', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
      } as any);

      const redis = module.get(getRedisConnectionToken('default'));
      const result = await service.generateOtp('test@example.com');

      expect(result).toHaveProperty('message');
      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, hash, mode, ttl] = (redis.set as jest.Mock).mock.calls[0];
      expect(key).toBe('otp:test@example.com');
      expect(hash).toHaveLength(64); // SHA-256 hex length
      expect(mode).toBe('EX');
      expect(ttl).toBe(300);
    });

    it('should reject non-existent user when generating OTP', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.generateOtp('unknown@example.com')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should verify matching OTP and delete key from Redis', async () => {
      const redis = module.get(getRedisConnectionToken('default'));
      const testOtp = '123456';
      const expectedHash = crypto
        .createHmac('sha256', getOtpSecret())
        .update(testOtp)
        .digest('hex');

      (redis.get as jest.Mock).mockResolvedValueOnce(expectedHash);

      const result = await service.verifyOtp('test@example.com', testOtp);
      expect(result).toEqual({ message: 'OTP verified successfully' });
      expect(redis.del).toHaveBeenCalledWith('otp:test@example.com');
    });

    it('should reject invalid OTP', async () => {
      const redis = module.get(getRedisConnectionToken('default'));
      (redis.get as jest.Mock).mockResolvedValueOnce('stored-hash');

      await expect(
        service.verifyOtp('test@example.com', 'wrong-otp'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
