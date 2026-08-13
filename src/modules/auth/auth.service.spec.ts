import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { createMockContext, MockContext } from '../../prisma/prisma.mock';
import * as bcrypt from 'bcrypt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';

jest.mock('bcrypt', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashedPassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthService', () => {
  let service: AuthService;
  let mockCtx: MockContext;

  beforeEach(async () => {
    mockCtx = createMockContext();
    const module: TestingModule = await Test.createTestingModule({
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
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
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
});
