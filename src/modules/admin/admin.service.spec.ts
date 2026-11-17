import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../upload/r2.service';
import { R2CleanupService } from '../upload/r2-cleanup.service';
import { EmailService } from '../../common/email/email.service';
import { AccountPurgeService } from '../account/account-purge.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

describe('AdminService user deletion guards', () => {
  let service: AdminService;

  // `$transaction` passes the mock itself as `tx` to the callback.
  // Inlining `cb(mockPrisma)` causes a circular type-inference cycle that TS
  // cannot resolve. Using an `any`-typed late-bound ref breaks the cycle:
  // TS sees no transitive self-reference, and the value is set before any
  // test code runs.
  // eslint-disable-next-line prefer-const
  let mockPrismaRef: any;
  const mockPrisma = {
    $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) =>
      cb(mockPrismaRef),
    ),
    $queryRaw: jest.fn(),
    course: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    class: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    enrollment: {
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    planPurchase: { count: jest.fn() },
    user: { create: jest.fn(), delete: jest.fn() },
  };
  mockPrismaRef = mockPrisma; // wire after construction — no TDZ

  const mockR2Service = {};
  const mockR2CleanupService = {};
  const mockEmailService = {};
  const mockAccountPurge = { purgeUser: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: R2Service, useValue: mockR2Service },
        { provide: R2CleanupService, useValue: mockR2CleanupService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: AccountPurgeService, useValue: mockAccountPurge },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  describe('createUser', () => {
    const dto = {
      email: 'dup@breadtrans.test',
      password: 'Password1!',
      role: Role.STUDENT,
      fullName: 'Trùng Email',
    } as never;

    it('answers 409 when the email is already registered', async () => {
      mockPrisma.user.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.createUser(dto)).rejects.toThrow(
        new ConflictException('Email đã tồn tại.'),
      );
    });

    it('does not disguise any other database failure as a conflict', async () => {
      const failure = new Error('connection lost');
      mockPrisma.user.create.mockRejectedValue(failure);

      await expect(service.createUser(dto)).rejects.toBe(failure);
    });
  });

  describe('admin "Xoá" uses the account purge (owner 2026-11-16)', () => {
    it('deletes through AccountPurgeService and reports the outcome', async () => {
      mockAccountPurge.purgeUser.mockResolvedValue('DELETED');

      await expect(service.deleteUser(7)).resolves.toEqual({
        id: 7,
        outcome: 'DELETED',
      });
      expect(mockAccountPurge.purgeUser).toHaveBeenCalledWith(7);
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('a user with payments becomes an anonymous shell, not a refusal', async () => {
      mockAccountPurge.purgeUser.mockResolvedValue('ANONYMIZED');

      await expect(service.deleteUser(99)).resolves.toEqual({
        id: 99,
        outcome: 'ANONYMIZED',
      });
    });

    it('passes NotFound through for a missing user', async () => {
      mockAccountPurge.purgeUser.mockRejectedValue(
        new NotFoundException('Người dùng không tồn tại'),
      );

      await expect(service.deleteUser(999)).rejects.toThrow(NotFoundException);
    });
  });
});
