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
import { EmailService } from '../../common/email/email.service';

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
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn(),
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
        {
          provide: EmailService,
          useValue: {
            sendRegistrationOtp: jest.fn(),
            sendTeacherActivation: jest.fn(),
          },
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

    it('should stage registration and create the student only after OTP verification', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null);
      const otp = '123456';
      const hash = crypto
        .createHmac('sha256', getOtpSecret())
        .update(otp)
        .digest('hex');
      await service.register({
        email: 'test@example.com',
        password: '123456',
        fullName: 'Test User',
      });
      expect(mockCtx.prisma.user.create).not.toHaveBeenCalled();
      redisMock.get
        .mockResolvedValueOnce(
          JSON.stringify({
            email: 'test@example.com',
            fullName: 'Test User',
            password: 'hashedPassword',
          }),
        )
        .mockResolvedValueOnce(hash);
      mockCtx.prisma.user.create.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        role: Role.STUDENT,
        profile: { fullName: 'Test User' },
      } as any);
      const result = await service.verifyRegistration('test@example.com', otp);
      expect(result).not.toHaveProperty('password');
      expect(mockCtx.prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: Role.STUDENT }),
        }),
      );
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

  describe('loginWithGoogle & linkGoogleWithPassword', () => {
    const originalEnv = process.env.GOOGLE_CLIENT_ID;

    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
      (mockCtx.prisma as any).authAccount = {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      };
    });

    afterEach(() => {
      process.env.GOOGLE_CLIENT_ID = originalEnv;
    });

    it('should create a new STUDENT user and AuthAccount on first Google login', async () => {
      jest.spyOn((service as any).googleClient, 'verifyIdToken').mockResolvedValue({
        getPayload: () => ({
          sub: 'google-sub-123',
          email: 'newuser@gmail.com',
          email_verified: true,
          name: 'Google Learner',
          picture: 'https://lh3.googleusercontent.com/pic.jpg',
        }),
      });

      (mockCtx.prisma as any).authAccount.findUnique.mockResolvedValue(null);
      mockCtx.prisma.user.findUnique.mockResolvedValue(null);
      mockCtx.prisma.user.create.mockResolvedValue({
        id: 99,
        email: 'newuser@gmail.com',
        role: Role.STUDENT,
        profile: { fullName: 'Google Learner', avatar: 'https://lh3.googleusercontent.com/pic.jpg' },
      } as any);

      const res = await service.loginWithGoogle({
        credential: 'valid-id-token',
        deviceId: 'device-abc',
      });

      expect(res).toHaveProperty('access_token');
      expect(res).toHaveProperty('refresh_token');
      expect(res.user.role).toBe(Role.STUDENT);
      expect(mockCtx.prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'newuser@gmail.com',
            role: Role.STUDENT,
            authAccounts: {
              create: {
                provider: 'GOOGLE',
                providerAccountId: 'google-sub-123',
              },
            },
          }),
        }),
      );
    });

    it('should login immediately if AuthAccount already exists', async () => {
      jest.spyOn((service as any).googleClient, 'verifyIdToken').mockResolvedValue({
        getPayload: () => ({
          sub: 'existing-google-sub',
          email: 'existing@gmail.com',
          email_verified: true,
          name: 'Existing User',
        }),
      });

      (mockCtx.prisma as any).authAccount.findUnique.mockResolvedValue({
        id: 1,
        provider: 'GOOGLE',
        providerAccountId: 'existing-google-sub',
        user: {
          id: 50,
          email: 'existing@gmail.com',
          role: Role.STUDENT,
          profile: { fullName: 'Existing User' },
        },
      });

      mockCtx.prisma.user.update.mockResolvedValue({} as any);

      const res = await service.loginWithGoogle({
        credential: 'valid-id-token',
        deviceId: 'device-xyz',
      });

      expect(res.user.id).toBe(50);
      expect(mockCtx.prisma.user.create).not.toHaveBeenCalled();
    });

    it('should throw ACCOUNT_LINK_REQUIRED if email already exists as a password account', async () => {
      jest.spyOn((service as any).googleClient, 'verifyIdToken').mockResolvedValue({
        getPayload: () => ({
          sub: 'unlinked-sub',
          email: 'passworduser@gmail.com',
          email_verified: true,
          name: 'Password User',
        }),
      });

      (mockCtx.prisma as any).authAccount.findUnique.mockResolvedValue(null);
      mockCtx.prisma.user.findUnique.mockResolvedValue({
        id: 12,
        email: 'passworduser@gmail.com',
        password: 'hashedpassword',
      } as any);

      await expect(
        service.loginWithGoogle({ credential: 'token-with-existing-email' }),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'ACCOUNT_LINK_REQUIRED',
          }),
        }),
      );
    });

    it('should successfully link account when providing correct password', async () => {
      jest.spyOn((service as any).googleClient, 'verifyIdToken').mockResolvedValue({
        getPayload: () => ({
          sub: 'google-sub-to-link',
          email: 'linkme@gmail.com',
          email_verified: true,
          name: 'Link Me',
        }),
      });

      mockCtx.prisma.user.findUnique.mockResolvedValue({
        id: 15,
        email: 'linkme@gmail.com',
        password: 'valid-hashed-password',
        role: Role.STUDENT,
        profile: { fullName: 'Link Me' },
      } as any);
      (mockCtx.prisma as any).authAccount.upsert.mockResolvedValue({});
      mockCtx.prisma.user.update.mockResolvedValue({} as any);

      const res = await service.linkGoogleWithPassword({
        email: 'linkme@gmail.com',
        password: 'valid-password',
        credential: 'google-id-token',
        deviceId: 'device-link',
      });

      expect(res.user.id).toBe(15);
      expect((mockCtx.prisma as any).authAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_providerAccountId: {
              provider: 'GOOGLE',
              providerAccountId: 'google-sub-to-link',
            },
          },
        }),
      );
    });
  });
});

