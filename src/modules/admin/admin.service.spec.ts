import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../upload/r2.service';
import { R2CleanupService } from '../upload/r2-cleanup.service';
import { CourseService } from '../course/course.service';
import { EmailService } from '../../common/email/email.service';
import { ClassStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

describe('AdminService - Enrollment Count Semantics (R1)', () => {
  let service: AdminService;

  const mockPrisma = {
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

  const mockR2Service = {};
  const mockR2CleanupService = {};
  const mockCourseService = {
    enrollInClass: jest.fn(),
  };
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

  describe('getAdminCourses & getAllClasses Semantics', () => {
    // ADMIN-CNT-01: ACTIVE=5, PENDING=3 -> activeEnrollmentCount=5, totalEnrollmentCount=8
    it('ADMIN-CNT-01: getAdminCourses returns activeEnrollmentCount=5 and totalEnrollmentCount=8 when ACTIVE=5, PENDING=3', async () => {
      mockPrisma.course.findMany.mockResolvedValue([
        {
          id: 101,
          title: 'IELTS Master',
          teacher: {
            id: 1,
            email: 't@example.com',
            profile: { fullName: 'Teacher' },
          },
          classes: [
            {
              id: 201,
              name: 'IELTS K01',
              status: ClassStatus.UPCOMING,
              capacity: 30,
              tuitionFeeVnd: 500000,
              _count: { enrollments: 8 }, // total 8 enrollments (5 ACTIVE + 3 PENDING)
              enrollments: [
                { id: 1 },
                { id: 2 },
                { id: 3 },
                { id: 4 },
                { id: 5 },
              ], // exactly 5 ACTIVE enrollments
            },
          ],
          _count: { classes: 1 },
        },
      ]);

      const result = await service.getAdminCourses();

      expect(result).toHaveLength(1);
      const cls = result[0].classes[0];
      expect(cls.activeEnrollmentCount).toBe(5);
      expect(cls.totalEnrollmentCount).toBe(8);
      expect(cls.hasEnrollments).toBe(true);
      expect(cls.tuitionFeeVnd).toBe(500000);
    });

    // ADMIN-CNT-02: ACTIVE=0, PENDING=1 -> tuition locked (hasEnrollments=true), capacity minimum remains 0
    it('ADMIN-CNT-02: getAdminCourses returns activeEnrollmentCount=0, totalEnrollmentCount=1, hasEnrollments=true when ACTIVE=0, PENDING=1', async () => {
      mockPrisma.course.findMany.mockResolvedValue([
        {
          id: 102,
          title: 'TOEIC Foundation',
          teacher: {
            id: 2,
            email: 't2@example.com',
            profile: { fullName: 'Teacher 2' },
          },
          classes: [
            {
              id: 202,
              name: 'TOEIC K01',
              status: ClassStatus.UPCOMING,
              capacity: 25,
              tuitionFeeVnd: 200000,
              _count: { enrollments: 1 }, // total 1 enrollment (PENDING_PAYMENT)
              enrollments: [], // 0 ACTIVE enrollments
            },
          ],
          _count: { classes: 1 },
        },
      ]);

      const result = await service.getAdminCourses();

      expect(result).toHaveLength(1);
      const cls = result[0].classes[0];
      // Capacity minimum is activeEnrollmentCount = 0 (seats occupied = 0)
      expect(cls.activeEnrollmentCount).toBe(0);
      // Total enrollment count = 1 -> tuition is locked
      expect(cls.totalEnrollmentCount).toBe(1);
      expect(cls.hasEnrollments).toBe(true);
    });

    it('ADMIN-CNT-03: getAllClasses also returns explicit activeEnrollmentCount, totalEnrollmentCount, and hasEnrollments', async () => {
      mockPrisma.class.findMany.mockResolvedValue([
        {
          id: 301,
          name: 'Class 301',
          capacity: 20,
          tuitionFeeVnd: 0,
          course: { id: 10, title: 'Course 10', thumbnail: null },
          teacher: { id: 3, email: 't3@example.com', profile: null },
          _count: { enrollments: 3 },
          enrollments: [{ id: 10 }, { id: 11 }], // 2 ACTIVE
        },
      ]);

      const result = await service.getAllClasses();

      expect(result).toHaveLength(1);
      expect(result[0].activeEnrollmentCount).toBe(2);
      expect(result[0].totalEnrollmentCount).toBe(3);
      expect(result[0].hasEnrollments).toBe(true);
    });
  });

  describe('Phase 3C-1 financial-history delete guards', () => {
    it('DEL-PAY-01: removes an Enrollment when it has no Payment', async () => {
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.enrollment.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.removeEnrollment(7, 11)).resolves.toEqual({
        count: 1,
      });
      expect(mockPrisma.payment.count).toHaveBeenCalledWith({
        where: { enrollment: { userId: 7, classId: 11 } },
      });
    });

    it('DEL-PAY-02: rejects Enrollment removal when retained Payment exists', async () => {
      mockPrisma.payment.count.mockResolvedValue(1);

      await expect(service.removeEnrollment(7, 11)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.enrollment.deleteMany).not.toHaveBeenCalled();
    });

    it('DEL-PAY-03: deletes a User without Payment-bearing Enrollment', async () => {
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.user.delete.mockResolvedValue({ id: 7 });

      await expect(service.deleteUser(7)).resolves.toEqual({ id: 7 });
    });

    it('DEL-PAY-04: rejects User deletion when retained Payment exists', async () => {
      mockPrisma.payment.count.mockResolvedValue(1);

      await expect(service.deleteUser(7)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('DEL-PAY-08: an unrelated Payment does not block scoped deletion', async () => {
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.user.delete.mockResolvedValue({ id: 8 });

      await service.deleteUser(8);
      expect(mockPrisma.payment.count).toHaveBeenCalledWith({
        where: { enrollment: { userId: 8 } },
      });
    });
  });
});
