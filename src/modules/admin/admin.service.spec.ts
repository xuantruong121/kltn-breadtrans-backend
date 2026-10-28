import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../upload/r2.service';
import { R2CleanupService } from '../upload/r2-cleanup.service';
import { CourseService } from '../course/course.service';
import { EmailService } from '../../common/email/email.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('AdminService - Enrollment Count Semantics (R1)', () => {
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
    payment: { count: jest.fn() },
    user: { delete: jest.fn() },
  };
  mockPrismaRef = mockPrisma; // wire after construction — no TDZ

  const mockR2Service = {};
  const mockR2CleanupService = {};
  const mockCourseService = {};
  const mockEmailService = {};

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: R2Service, useValue: mockR2Service },
        { provide: R2CleanupService, useValue: mockR2CleanupService },
        { provide: CourseService, useValue: mockCourseService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  describe('getAdminCourses (self-paced, no classes)', () => {
    it('lists courses without classes, enrollments or tuition', async () => {
      mockPrisma.course.findMany.mockResolvedValue([{ id: 1, title: 'A' }]);
      await expect(service.getAdminCourses()).resolves.toEqual([
        { id: 1, title: 'A' },
      ]);
      const query = mockPrisma.course.findMany.mock.calls[0][0];
      expect(JSON.stringify(query)).not.toMatch(/classes|enrollments/);
    });
  });

  describe('Phase 3C-1 financial-history delete guards', () => {
    it('DEL-PAY-03: deletes a User without Payment-bearing Enrollment or review history', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 7, role: 'STUDENT' }]);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.user.delete.mockResolvedValue({ id: 7 });

      await expect(service.deleteUser(7)).resolves.toEqual({ id: 7 });
      expect(mockPrisma.payment.count).toHaveBeenCalledWith({
        where: {
          OR: [{ enrollment: { userId: 7 } }, { reviewedById: 7 }],
        },
      });
    });

    it('DEL-PAY-04: rejects User deletion when retained Payment exists for student', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 7, role: 'STUDENT' }]);
      mockPrisma.payment.count.mockResolvedValue(1);

      await expect(service.deleteUser(7)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('DEL-PAY-05: rejects User deletion when retained reviewed Payment exists for admin reviewer', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 99, role: 'ADMIN' }]);
      mockPrisma.payment.count.mockResolvedValue(1);

      await expect(service.deleteUser(99)).rejects.toThrow(ConflictException);
      expect(mockPrisma.payment.count).toHaveBeenCalledWith({
        where: {
          OR: [{ enrollment: { userId: 99 } }, { reviewedById: 99 }],
        },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('DEL-PAY-06: throws NotFoundException when user does not exist', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.deleteUser(999)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.payment.count).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('DEL-PAY-08: an unrelated Payment does not block scoped deletion', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 8, role: 'STUDENT' }]);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.user.delete.mockResolvedValue({ id: 8 });

      await service.deleteUser(8);
      expect(mockPrisma.payment.count).toHaveBeenCalledWith({
        where: {
          OR: [{ enrollment: { userId: 8 } }, { reviewedById: 8 }],
        },
      });
    });
  });
});
