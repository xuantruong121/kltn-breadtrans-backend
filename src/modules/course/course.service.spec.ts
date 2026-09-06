import { Test, TestingModule } from '@nestjs/testing';
import { CourseService } from './course.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import {
  Role,
  CourseStatus,
  ClassStatus,
  EnrollmentStatus,
} from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('CourseService - Business Logic & Rules', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    class: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    lesson: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    material: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    session: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    enrollment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    payment: { count: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((input: unknown): unknown => {
      if (typeof input === 'function') {
        const transaction = input as (client: unknown) => unknown;
        return transaction(mockPrisma);
      }
      return Array.isArray(input) ? Promise.all(input) : input;
    }),
  };

  const mockEventsGateway = {
    broadcastCourseUpdate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockEventsGateway },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================
  // I. COURSE TEST CASES (1 -> 7)
  // ==========================================
  describe('Course Lifecycle & Ownership', () => {
    // 1. Teacher tạo Course thành công -> DRAFT
    it('1. Teacher tạo Course thành công -> DRAFT', async () => {
      mockPrisma.course.create.mockResolvedValue({
        id: 1,
        title: 'IELTS Preparation',
        teacherId: 10,
        status: CourseStatus.DRAFT,
      });

      const result = await service.createCourse(
        { title: 'IELTS Preparation' },
        { id: 10, role: Role.TEACHER },
      );

      expect(mockPrisma.course.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'IELTS Preparation',
            teacherId: 10,
            status: CourseStatus.DRAFT,
          }),
        }),
      );
      expect(result.status).toBe(CourseStatus.DRAFT);
      expect(mockEventsGateway.broadcastCourseUpdate).toHaveBeenCalled();
    });

    // 2. Student tạo Course -> bị từ chối
    it('2. Student tạo Course -> bị từ chối với 403 Forbidden', async () => {
      await expect(
        service.createCourse(
          { title: 'Hacked Course' },
          { id: 99, role: Role.STUDENT },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // 3. Teacher submit Course -> PENDING_REVIEW
    it('3. Teacher submit Course -> PENDING_REVIEW', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.DRAFT,
      });
      mockPrisma.course.update.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.PENDING_REVIEW,
      });

      const result = await service.submitCourseForReview(1, {
        id: 10,
        role: Role.TEACHER,
      });

      expect(mockPrisma.course.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: CourseStatus.PENDING_REVIEW },
      });
      expect(result.status).toBe(CourseStatus.PENDING_REVIEW);
    });

    // 4. Admin approve -> PUBLISHED
    it('4. Admin approve -> PUBLISHED', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        status: CourseStatus.PENDING_REVIEW,
      });
      mockPrisma.course.update.mockResolvedValue({
        id: 1,
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.reviewCourse(1, 'APPROVE', {
        id: 1,
        role: Role.ADMIN,
      });

      expect(mockPrisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { status: CourseStatus.PUBLISHED },
        }),
      );
      expect(result.status).toBe(CourseStatus.PUBLISHED);
    });

    // 5. Admin reject -> REJECTED
    it('5. Admin reject -> REJECTED', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        status: CourseStatus.PENDING_REVIEW,
      });
      mockPrisma.course.update.mockResolvedValue({
        id: 1,
        status: CourseStatus.REJECTED,
      });

      const result = await service.reviewCourse(1, 'REJECT', {
        id: 1,
        role: Role.ADMIN,
      });

      expect(mockPrisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { status: CourseStatus.REJECTED },
        }),
      );
      expect(result.status).toBe(CourseStatus.REJECTED);
    });

    // 6. Teacher sửa Course của mình
    it('6. Teacher sửa Course của mình thành công', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.DRAFT,
      });
      mockPrisma.course.update.mockResolvedValue({
        id: 1,
        title: 'IELTS Updated Title',
        teacherId: 10,
        status: CourseStatus.DRAFT,
      });

      const result = await service.updateCourse(
        1,
        { title: 'IELTS Updated Title' },
        { id: 10, role: Role.TEACHER },
      );

      expect(result.title).toBe('IELTS Updated Title');
    });

    // 7. Teacher sửa Course của Teacher khác -> 403
    it('7. Teacher sửa Course của Teacher khác -> bị từ chối 403', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 2,
        teacherId: 20, // Owned by teacher 20
        status: CourseStatus.DRAFT,
      });

      await expect(
        service.updateCourse(
          2,
          { title: 'Malicious Change' },
          { id: 10, role: Role.TEACHER }, // Caller is teacher 10
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==========================================
  // II. CLASS TEST CASES (8 -> 16)
  // ==========================================
  describe('Class Creation, Validation & Lifecycle', () => {
    // 8. Teacher tạo Class từ PUBLISHED Course -> thành công
    it('8. Teacher tạo Class từ PUBLISHED Course -> thành công', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.PUBLISHED,
      });
      mockPrisma.class.findFirst.mockResolvedValue(null); // Không trùng tên
      mockPrisma.class.create.mockResolvedValue({
        id: 101,
        name: 'Class K01',
        courseId: 1,
        teacherId: 10,
        status: ClassStatus.UPCOMING,
      });

      const result = await service.createClass(
        1,
        { id: 10, role: Role.TEACHER },
        { name: 'Class K01' },
      );

      expect(result.id).toBe(101);
      expect(result.status).toBe(ClassStatus.UPCOMING);
    });

    // 9. Teacher tạo Class từ DRAFT Course -> bị từ chối
    it('9. Teacher tạo Class từ DRAFT Course -> bị từ chối 400', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.DRAFT,
      });

      await expect(
        service.createClass(
          1,
          { id: 10, role: Role.TEACHER },
          { name: 'Class K01' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 10. Teacher tạo Class từ PENDING_REVIEW Course -> bị từ chối
    it('10. Teacher tạo Class từ PENDING_REVIEW Course -> bị từ chối 400', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.PENDING_REVIEW,
      });

      await expect(
        service.createClass(
          1,
          { id: 10, role: Role.TEACHER },
          { name: 'Class K01' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 11. Teacher tạo Class của Course không thuộc quyền -> 403
    it('11. Teacher tạo Class của Course không thuộc quyền -> 403', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 2,
        teacherId: 20, // Owned by teacher 20
        status: CourseStatus.PUBLISHED,
      });

      await expect(
        service.createClass(
          2,
          { id: 10, role: Role.TEACHER }, // Caller is teacher 10
          { name: 'Class K01' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // 12. Course không tồn tại -> 404
    it('12. Course không tồn tại -> 404 Not Found', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(
        service.createClass(
          999,
          { id: 10, role: Role.TEACHER },
          { name: 'Class K01' },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    // 13. teacherId là STUDENT -> bị từ chối
    it('13. Admin tạo Class gán teacherId là STUDENT -> bị từ chối 400', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.PUBLISHED,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 50,
        role: Role.STUDENT, // User is a student
      });

      await expect(
        service.createClass(
          1,
          { id: 1, role: Role.ADMIN },
          { name: 'Class K01', teacherId: 50 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 14. teacherId không tồn tại -> 404
    it('14. Admin tạo Class gán teacherId không tồn tại -> 404', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.PUBLISHED,
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createClass(
          1,
          { id: 1, role: Role.ADMIN },
          { name: 'Class K01', teacherId: 999 },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    // 15. startDate >= endDate -> bị từ chối
    it('15. startDate >= endDate -> bị từ chối 400', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.PUBLISHED,
      });

      await expect(
        service.createClass(
          1,
          { id: 10, role: Role.TEACHER },
          {
            name: 'Class K01',
            startDate: '2026-10-01T00:00:00.000Z',
            endDate: '2026-09-01T00:00:00.000Z', // End before start
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 16. Class tạo mới có trạng thái hợp lý, không hard-code ONGOING
    it('16. Class với ngày bắt đầu trong tương lai có status UPCOMING', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.PUBLISHED,
      });
      mockPrisma.class.findFirst.mockResolvedValue(null);
      mockPrisma.class.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 102, ...data }),
      );

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);

      const result = await service.createClass(
        1,
        { id: 10, role: Role.TEACHER },
        {
          name: 'Future Class',
          startDate: futureDate.toISOString(),
        },
      );

      expect(result.status).toBe(ClassStatus.UPCOMING);
    });
  });

  // ==========================================
  // III. ENROLLMENT TEST CASES (17 -> 20)
  // ==========================================
  // III. ENROLLMENT TEST CASES (Phase 3B Lifecycle & Concurrency Rules)
  // ==========================================
  describe('Enrollment Business Rules (Phase 3B)', () => {
    // 17. Student enroll FREE class (tuitionFeeVnd = 0) -> ACTIVE
    it('17. Student enroll FREE class (tuitionFeeVnd = 0) -> ACTIVE', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.UPCOMING,
          capacity: 30,
          tuitionFeeVnd: 0,
        },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null); // Chưa enroll
      mockPrisma.enrollment.count.mockResolvedValue(5); // 5 active enrollments
      mockPrisma.enrollment.create.mockResolvedValue({
        id: 201,
        userId: 100,
        classId: 1,
        status: EnrollmentStatus.ACTIVE,
      });

      const result = await service.enrollInClass(1, 100);

      expect(result.status).toBe(EnrollmentStatus.ACTIVE);
      expect(result.accessGranted).toBe(true);
      expect(result.tuitionFeeVnd).toBe(0);
      expect(mockPrisma.enrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 100,
            classId: 1,
            status: EnrollmentStatus.ACTIVE,
          }),
        }),
      );
    });

    // 17b. Student enroll PAID class (tuitionFeeVnd > 0) -> PENDING_PAYMENT
    it('17b. Student enroll PAID class (tuitionFeeVnd > 0) -> PENDING_PAYMENT (no access)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 2,
          status: ClassStatus.UPCOMING,
          capacity: 25,
          tuitionFeeVnd: 1500000,
        },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.count.mockResolvedValue(10);
      mockPrisma.enrollment.create.mockResolvedValue({
        id: 202,
        userId: 100,
        classId: 2,
        status: EnrollmentStatus.PENDING_PAYMENT,
      });

      const result = await service.enrollInClass(2, 100);

      expect(result.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      expect(result.accessGranted).toBe(false);
      expect(result.tuitionFeeVnd).toBe(1500000);
      expect(mockPrisma.enrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: EnrollmentStatus.PENDING_PAYMENT,
          }),
        }),
      );
    });

    // 18. Student enroll trùng -> bị từ chối 409 Conflict
    it('18. Student enroll trùng -> bị từ chối 409 Conflict', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.UPCOMING,
          capacity: 30,
          tuitionFeeVnd: 0,
        },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 201,
        userId: 100,
        classId: 1,
      }); // Đã tồn tại

      await expect(service.enrollInClass(1, 100)).rejects.toThrow(
        ConflictException,
      );
    });

    // 19. Class full capacity (activeCount >= capacity) -> 409 Conflict
    it('19. Class full capacity (activeCount >= capacity) -> bị từ chối 409 Conflict', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.UPCOMING,
          capacity: 10,
          tuitionFeeVnd: 0,
        },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.count.mockResolvedValue(10); // Đã đầy 10/10 ACTIVE

      await expect(service.enrollInClass(1, 101)).rejects.toThrow(
        ConflictException,
      );
    });

    // 20. Enroll vào Class CANCELLED -> bị từ chối 400
    it('20. Enroll vào Class CANCELLED -> bị từ chối 400 BadRequest', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.CANCELLED,
          capacity: 30,
          tuitionFeeVnd: 0,
        },
      ]);

      await expect(service.enrollInClass(1, 102)).rejects.toThrow(
        BadRequestException,
      );
    });

    // 20b. Enroll vào Class COMPLETED -> bị từ chối 400
    it('20b. Enroll vào Class COMPLETED -> bị từ chối 400 BadRequest', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.COMPLETED,
          capacity: 30,
          tuitionFeeVnd: 0,
        },
      ]);

      await expect(service.enrollInClass(1, 103)).rejects.toThrow(
        BadRequestException,
      );
    });

    // 20c. Student enroll vào Class ONGOING -> bị từ chối 400 (Student only UPCOMING)
    it('20c. Student enroll vào Class ONGOING -> bị từ chối 400 (Student only UPCOMING)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.ONGOING,
          capacity: 30,
          tuitionFeeVnd: 0,
        },
      ]);

      await expect(service.enrollInClass(1, 104)).rejects.toThrow(
        BadRequestException,
      );
    });

    // 20d. Admin override enrolls into ONGOING -> ACTIVE
    it('20d. Admin override enrolls into ONGOING -> ACTIVE', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.ONGOING,
          capacity: 30,
          tuitionFeeVnd: 500000,
        },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.count.mockResolvedValue(5);
      mockPrisma.enrollment.create.mockResolvedValue({
        id: 203,
        userId: 105,
        classId: 1,
        status: EnrollmentStatus.ACTIVE,
      });

      const result = await service.enrollInClass(1, 105, {
        isAdminOverride: true,
      });

      expect(result.status).toBe(EnrollmentStatus.ACTIVE);
      expect(result.accessGranted).toBe(true);
    });

    // 20e. Admin override CANNOT bypass capacity
    it('20e. Admin override CANNOT bypass capacity -> 409 Conflict', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.UPCOMING,
          capacity: 20,
          tuitionFeeVnd: 0,
        },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.count.mockResolvedValue(20); // Full

      await expect(
        service.enrollInClass(1, 106, { isAdminOverride: true }),
      ).rejects.toThrow(ConflictException);
    });

    // 20f. Admin override CANNOT bypass CANCELLED / COMPLETED
    it('20f. Admin override CANNOT bypass CANCELLED / COMPLETED -> 400 BadRequest', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.CANCELLED,
          capacity: 30,
          tuitionFeeVnd: 0,
        },
      ]);

      await expect(
        service.enrollInClass(1, 107, { isAdminOverride: true }),
      ).rejects.toThrow(BadRequestException);
    });

    // ADM-OVR-01: Admin manually enrolls Student into UPCOMING paid Class -> ACTIVE
    it('ADM-OVR-01: Admin manually enrolls Student into UPCOMING paid Class -> ACTIVE', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.UPCOMING,
          capacity: 30,
          tuitionFeeVnd: 500000, // Paid class
        },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.enrollment.create.mockResolvedValue({
        id: 204,
        userId: 108,
        classId: 1,
        status: EnrollmentStatus.ACTIVE,
      });

      const result = await service.enrollInClass(1, 108, {
        isAdminOverride: true,
      });

      expect(result.status).toBe(EnrollmentStatus.ACTIVE);
      expect(result.accessGranted).toBe(true);
      expect(result.tuitionFeeVnd).toBe(500000);
    });

    // ADM-OVR-02: Admin manually enrolls Student already enrolled -> 409 Conflict
    it('ADM-OVR-02: Admin manually enrolls Student already enrolled -> 409 Conflict', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.UPCOMING,
          capacity: 30,
          tuitionFeeVnd: 500000,
        },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 99,
        userId: 108,
        classId: 1,
        status: EnrollmentStatus.ACTIVE,
      });

      await expect(
        service.enrollInClass(1, 108, { isAdminOverride: true }),
      ).rejects.toThrow(ConflictException);
    });

    // ADM-OVR-03: Admin manually enrolls into COMPLETED Class -> rejected (400)
    it('ADM-OVR-03: Admin manually enrolls into COMPLETED Class -> 400 BadRequest', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 1,
          status: ClassStatus.COMPLETED,
          capacity: 30,
          tuitionFeeVnd: 500000,
        },
      ]);

      await expect(
        service.enrollInClass(1, 108, { isAdminOverride: true }),
      ).rejects.toThrow(BadRequestException);
    });

    // TEACHER-CNT-01: ACTIVE=0, PENDING_PAYMENT=1 -> tuition input locked (hasEnrollments=true)
    it('TEACHER-CNT-01: ACTIVE=0, PENDING_PAYMENT=1 -> tuition is locked because totalEnrollmentCount=1', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.UPCOMING,
        tuitionFeeVnd: 100000,
      });
      // 1 total enrollment exists (PENDING_PAYMENT)
      mockPrisma.enrollment.count.mockResolvedValue(1);

      await expect(
        service.updateClass(
          1,
          { id: 10, role: Role.TEACHER },
          { tuitionFeeVnd: 250000 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // TEACHER-CNT-02: ACTIVE=2, PENDING_PAYMENT=5, capacity=3 -> reducing capacity to 2 allowed, reducing to 1 blocked
    it('TEACHER-CNT-02: ACTIVE=2, PENDING=5, capacity=3 -> reducing capacity to 2 allowed, reducing to 1 blocked', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.UPCOMING,
        capacity: 3,
        tuitionFeeVnd: 0,
      });
      // Exactly 2 ACTIVE enrollments exist
      mockPrisma.enrollment.count.mockResolvedValue(2);

      // 1. Reducing to 1 (< 2 active) -> BLOCKED
      await expect(
        service.updateClass(1, { id: 10, role: Role.TEACHER }, { capacity: 1 }),
      ).rejects.toThrow(BadRequestException);

      // 2. Reducing to 2 (== 2 active) -> ALLOWED
      mockPrisma.class.update.mockResolvedValue({
        id: 1,
        capacity: 2,
        status: ClassStatus.UPCOMING,
        _count: { enrollments: 7 },
      });

      const updated = await service.updateClass(
        1,
        { id: 10, role: Role.TEACHER },
        { capacity: 2 },
      );
      expect(updated.capacity).toBe(2);
      expect(updated.activeEnrollmentCount).toBe(2);
    });

    // 20g. Tuition Lock: Cannot change tuitionFeeVnd when totalEnrollments > 0
    it('20g. Tuition Lock: Cannot change tuitionFeeVnd when totalEnrollments > 0 -> 400 BadRequest', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.UPCOMING,
        tuitionFeeVnd: 0,
      });
      mockPrisma.enrollment.count.mockResolvedValue(1); // 1 enrollment exists

      await expect(
        service.updateClass(
          1,
          { id: 10, role: Role.TEACHER },
          { tuitionFeeVnd: 200000 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 20h. Tuition Lock: Cannot change tuitionFeeVnd when status != UPCOMING
    it('20h. Tuition Lock: Cannot change tuitionFeeVnd when status != UPCOMING -> 400 BadRequest', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.ONGOING,
        tuitionFeeVnd: 0,
      });

      await expect(
        service.updateClass(
          1,
          { id: 10, role: Role.TEACHER },
          { tuitionFeeVnd: 300000 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 20i. Tuition Change Allowed: UPCOMING with 0 total enrollments
    it('20i. Tuition Change Allowed: UPCOMING with 0 total enrollments', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.UPCOMING,
        tuitionFeeVnd: 0,
      });
      mockPrisma.enrollment.count.mockResolvedValue(0); // 0 enrollments
      mockPrisma.class.update.mockResolvedValue({
        id: 1,
        tuitionFeeVnd: 500000,
        status: ClassStatus.UPCOMING,
        _count: { enrollments: 0 },
      });

      const result = await service.updateClass(
        1,
        { id: 10, role: Role.TEACHER },
        { tuitionFeeVnd: 500000 },
      );

      expect(result.tuitionFeeVnd).toBe(500000);
      expect(result.hasEnrollments).toBe(false);
    });

    // 20j. getMyEnrollmentsInCourse returns user enrollments
    it('20j. getMyEnrollmentsInCourse returns user enrollments for the course', async () => {
      mockPrisma.enrollment.findMany.mockResolvedValue([
        {
          id: 501,
          classId: 10,
          status: EnrollmentStatus.ACTIVE,
          joinedAt: new Date(),
        },
      ]);

      const result = await service.getMyEnrollmentsInCourse(1, 100);

      expect(result).toHaveLength(1);
      expect(result[0].classId).toBe(10);
      expect(result[0].status).toBe(EnrollmentStatus.ACTIVE);
    });
  });

  // ==========================================
  // IV. PHASE 2 - ADVANCED RULES & CONTENT TESTS
  // ==========================================
  describe('Phase 2 - Revert to Draft & Course Protection', () => {
    // 21. Revert to draft thành công khi không có lớp ONGOING
    it('21. Revert to draft thành công khi không có lớp ONGOING', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        status: CourseStatus.PUBLISHED,
        teacherId: 10,
      });
      mockPrisma.class.count.mockResolvedValue(0); // Không có lớp ONGOING
      mockPrisma.course.update.mockResolvedValue({
        id: 1,
        status: CourseStatus.DRAFT,
      });

      const result = await service.revertCourseToDraft(1, {
        id: 10,
        role: Role.TEACHER,
      });
      expect(result.status).toBe(CourseStatus.DRAFT);
      expect(mockEventsGateway.broadcastCourseUpdate).toHaveBeenCalled();
    });

    // 22. Revert to draft bị từ chối khi có lớp ONGOING
    it('22. Revert to draft bị từ chối khi có lớp ONGOING -> 400', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        status: CourseStatus.PUBLISHED,
        teacherId: 10,
      });
      mockPrisma.class.count.mockResolvedValue(1); // Đang có 1 lớp ONGOING

      await expect(
        service.revertCourseToDraft(1, { id: 10, role: Role.TEACHER }),
      ).rejects.toThrow(BadRequestException);
    });

    // 22b. Revert to draft bị từ chối khi status là PENDING_REVIEW -> 400
    it('22b. Revert to draft bị từ chối khi status là PENDING_REVIEW -> 400', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        status: CourseStatus.PENDING_REVIEW,
        teacherId: 10,
      });

      await expect(
        service.revertCourseToDraft(1, { id: 10, role: Role.TEACHER }),
      ).rejects.toThrow(
        'Khóa học đang chờ Admin duyệt và không thể chuyển về Bản nháp.',
      );
    });

    // 22c. Revert to draft thành công khi status là REJECTED -> DRAFT
    it('22c. Revert to draft thành công khi status là REJECTED -> DRAFT', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        status: CourseStatus.REJECTED,
        teacherId: 10,
      });
      mockPrisma.class.count.mockResolvedValue(0);
      mockPrisma.course.update.mockResolvedValue({
        id: 1,
        status: CourseStatus.DRAFT,
      });

      const result = await service.revertCourseToDraft(1, {
        id: 10,
        role: Role.TEACHER,
      });
      expect(result.status).toBe(CourseStatus.DRAFT);
    });

    // 23. Teacher sửa title/level trên Course PUBLISHED -> bị từ chối 400
    it('23. Teacher sửa title/level trên Course PUBLISHED -> bị từ chối 400', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        status: CourseStatus.PUBLISHED,
        teacherId: 10,
      });

      await expect(
        service.updateCourse(
          1,
          { title: 'New Title' },
          { id: 10, role: Role.TEACHER },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 24. Teacher sửa thumbnail trên Course PUBLISHED -> cho phép
    it('24. Teacher sửa thumbnail trên Course PUBLISHED -> cho phép', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        status: CourseStatus.PUBLISHED,
        teacherId: 10,
      });
      mockPrisma.course.update.mockResolvedValue({
        id: 1,
        status: CourseStatus.PUBLISHED,
        thumbnail: 'https://new-thumbnail.png',
      });

      const res = await service.updateCourse(
        1,
        { thumbnail: 'https://new-thumbnail.png' },
        { id: 10, role: Role.TEACHER },
      );
      expect(res.thumbnail).toBe('https://new-thumbnail.png');
    });
  });

  describe('Phase 2 - Lessons & Materials Ownership', () => {
    // 25. Teacher thêm lesson vào Course của Teacher khác -> 403
    it('25. Teacher thêm lesson vào Course của Teacher khác -> 403 Forbidden', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 99, // của Teacher 99
        status: CourseStatus.DRAFT,
      });

      await expect(
        service.createLesson(
          1,
          { id: 10, role: Role.TEACHER },
          { title: 'Lesson 1' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // 26. Teacher thêm lesson vào Course đang PENDING_REVIEW -> 400
    it('26. Teacher thêm lesson vào Course đang PENDING_REVIEW -> 400 BadRequest', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: CourseStatus.PENDING_REVIEW,
      });

      await expect(
        service.createLesson(
          1,
          { id: 10, role: Role.TEACHER },
          { title: 'Lesson 1' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 27. Teacher sửa lesson của Teacher khác -> 403
    it('27. Teacher sửa lesson của Teacher khác -> 403 Forbidden', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        id: 5,
        course: { teacherId: 99, status: CourseStatus.DRAFT },
      });

      await expect(
        service.updateLesson(
          5,
          { id: 10, role: Role.TEACHER },
          { title: 'Updated' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // 28. Teacher thêm material vào lesson của Teacher khác -> 403
    it('28. Teacher thêm material vào lesson của Teacher khác -> 403 Forbidden', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        id: 5,
        course: { teacherId: 99, status: CourseStatus.DRAFT },
      });

      await expect(
        service.createMaterial(
          5,
          { id: 10, role: Role.TEACHER },
          { title: 'Doc', fileUrl: 'https://doc.pdf' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Phase 2 - Class Safety & Session Consistency', () => {
    // 29. Update Class capacity nhỏ hơn current enrollment -> 400
    it('29. Update Class capacity nhỏ hơn current enrollment -> 400 BadRequest', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.UPCOMING,
        name: 'Class 1',
      });
      mockPrisma.enrollment.count.mockResolvedValue(25); // 25 students enrolled

      await expect(
        service.updateClass(
          1,
          { id: 10, role: Role.TEACHER },
          { capacity: 20 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 30. Update Class đã COMPLETED hoặc CANCELLED -> 400
    it('30. Update Class đã COMPLETED hoặc CANCELLED -> 400 BadRequest', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.COMPLETED,
        name: 'Class 1',
      });

      await expect(
        service.updateClass(
          1,
          { id: 10, role: Role.TEACHER },
          { name: 'New Name' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 31. Class ONGOING không cho phép sửa startDate lịch sử -> 400
    it('31. Class ONGOING không cho phép sửa startDate lịch sử -> 400 BadRequest', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.ONGOING,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        name: 'Class 1',
      });

      await expect(
        service.updateClass(
          1,
          { id: 10, role: Role.TEACHER },
          { startDate: '2026-08-10T00:00:00.000Z' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 32. Class Session Consistency: endDate trước latest session endTime -> 400
    it('32. Class Session Consistency: endDate trước latest session endTime -> 400', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.UPCOMING,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        name: 'Class 1',
      });
      mockPrisma.session.findFirst.mockResolvedValue({
        id: 10,
        endTime: new Date('2026-08-30T10:00:00.000Z'),
      });

      await expect(
        service.updateClass(
          1,
          { id: 10, role: Role.TEACHER },
          { endDate: '2026-08-25T00:00:00.000Z' }, // trước 30/08
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // 33. Teacher không được tự ý đổi teacherId của Class -> 403
    it('33. Teacher không được tự ý đổi teacherId của Class -> 403 Forbidden', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
        status: ClassStatus.UPCOMING,
        name: 'Class 1',
      });

      await expect(
        service.updateClass(
          1,
          { id: 10, role: Role.TEACHER },
          { teacherId: 99 },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // 34. Delete Class có học viên -> 400 (yêu cầu chuyển CANCELLED)
    it('34. Delete Class có học viên -> 400 BadRequest', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        teacherId: 10,
      });
      mockPrisma.enrollment.count.mockResolvedValue(5); // Có 5 học viên

      await expect(
        service.deleteClass(1, { id: 10, role: Role.TEACHER }),
      ).rejects.toThrow(BadRequestException);
    });

    // 35. X01: Teacher A sửa Course của Teacher B -> 403 Forbidden
    it('35. X01: Teacher A sửa Course của Teacher B -> 403 Forbidden', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 15,
        teacherId: 42, // Teacher B
        status: CourseStatus.DRAFT,
      });

      await expect(
        service.updateCourse(
          15,
          { description: 'Hacked' },
          { id: 41, role: Role.TEACHER },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // 36. X02: Teacher A sửa Class của Teacher B -> 403 Forbidden
    it('36. X02: Teacher A sửa Class của Teacher B -> 403 Forbidden', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 18,
        teacherId: 42, // Teacher B
        status: ClassStatus.UPCOMING,
      });

      await expect(
        service.updateClass(
          18,
          { id: 41, role: Role.TEACHER },
          { name: 'Hacked' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // 37. X05: Direct revertCourseToDraft khi có lớp ONGOING -> 400 BadRequest
    it('37. X05: Direct revertCourseToDraft khi có lớp ONGOING -> 400 BadRequest', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 13,
        teacherId: 41,
        status: CourseStatus.PUBLISHED,
      });
      mockPrisma.class.count.mockResolvedValue(2); // 2 lớp ONGOING

      await expect(
        service.revertCourseToDraft(13, { id: 41, role: Role.TEACHER }),
      ).rejects.toThrow(BadRequestException);
    });

    // 38. X06: Student chưa ghi danh gọi getClassById -> 403 Forbidden
    it('38. X06: Student chưa ghi danh gọi getClassById -> 403 Forbidden', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 18,
        teacherId: 42,
        course: { lessons: [{ materials: [] }] },
      });
      mockPrisma.enrollment.findFirst.mockResolvedValue(null); // Chưa ghi danh

      await expect(service.getClassById(18, 47, 'STUDENT')).rejects.toThrow(
        ForbiddenException,
      );
    });

    // 39. P3-PRE-01: Teacher resubmits a REJECTED course -> PENDING_REVIEW
    it('39. P3-PRE-01: Teacher resubmits a REJECTED course -> PENDING_REVIEW', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 10,
        teacherId: 20,
        status: CourseStatus.REJECTED,
      });
      mockPrisma.course.update.mockResolvedValue({
        id: 10,
        teacherId: 20,
        status: CourseStatus.PENDING_REVIEW,
      });

      const result = await service.submitCourseForReview(10, {
        id: 20,
        role: Role.TEACHER,
      });

      expect(mockPrisma.course.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { status: CourseStatus.PENDING_REVIEW },
      });
      expect(result.status).toBe(CourseStatus.PENDING_REVIEW);
    });

    // 40. P3-PRE-01: Teacher reverts a REJECTED course -> DRAFT
    it('40. P3-PRE-01: Teacher reverts a REJECTED course -> DRAFT', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 10,
        teacherId: 20,
        status: CourseStatus.REJECTED,
      });
      mockPrisma.class.count.mockResolvedValue(0);
      mockPrisma.course.update.mockResolvedValue({
        id: 10,
        teacherId: 20,
        status: CourseStatus.DRAFT,
      });

      const result = await service.revertCourseToDraft(10, {
        id: 20,
        role: Role.TEACHER,
      });

      expect(mockPrisma.course.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { status: CourseStatus.DRAFT },
      });
      expect(result.status).toBe(CourseStatus.DRAFT);
    });

    // 41. P3-PRE-02: Student calls getCourseById -> private assets sanitized
    it('41. P3-PRE-02: Student calls getCourseById -> private assets sanitized', async () => {
      const mockRawCourse = {
        id: 100,
        title: 'Mastering English',
        description: 'Comprehensive course',
        thumbnail: 'https://r2.dev/thumb.jpg',
        level: 'INTERMEDIATE',
        status: CourseStatus.PUBLISHED,
        teacherId: 30,
        teacher: {
          id: 30,
          email: 't@example.com',
          profile: { fullName: 'Teacher John' },
        },
        lessons: [
          {
            id: 1,
            courseId: 100,
            title: 'Lesson 1: Greetings',
            description: 'Learn greetings',
            order: 1,
            videoUrl: 'https://r2.dev/secret-video.mp4',
            createdAt: new Date(),
            materials: [
              {
                id: 101,
                lessonId: 1,
                title: 'Lesson 1 Slides.pdf',
                fileType: 'application/pdf',
                fileUrl: 'https://r2.dev/secret-slides.pdf',
              },
            ],
          },
        ],
        classes: [
          {
            id: 50,
            courseId: 100,
            name: 'Class A1',
            status: ClassStatus.UPCOMING,
            startDate: new Date('2026-10-01'),
            endDate: new Date('2026-12-01'),
            capacity: 25,
            meetingLink: 'https://daily.co/secret-room-123',
            links: { zalo: 'https://zalo.me/secret' },
            teacher: {
              id: 30,
              email: 't@example.com',
              profile: { fullName: 'Teacher John' },
            },
            _count: { enrollments: 10 },
          },
        ],
        quizzes: [
          { id: 1, title: 'Secret Quiz', questions: [{ text: 'Question 1' }] },
        ],
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockRawCourse);

      const result = await service.getCourseById(100, 999, Role.STUDENT);

      // Verify safe course overview fields are present
      expect(result.id).toBe(100);
      expect(result.title).toBe('Mastering English');
      expect(result.teacher?.email).toBe('t@example.com');
      expect(result.lessons).toHaveLength(1);
      expect(result.lessons[0].title).toBe('Lesson 1: Greetings');

      // CRITICAL: Verify private assets are sanitized/null
      expect(result.lessons[0].videoUrl).toBeNull();
      expect(result.lessons[0].materials[0].title).toBe('Lesson 1 Slides.pdf');
      expect(result.lessons[0].materials[0].fileUrl).toBeNull();

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('Class A1');
      expect(result.classes[0].meetingLink).toBeNull();

      // Quizzes should not leak internal questions
      expect(result.quizzes).toEqual([]);
    });

    // 42. P3-PRE-02: Teacher Owner calls getCourseById -> receives full studio data
    it('42. P3-PRE-02: Teacher Owner calls getCourseById -> receives full studio data', async () => {
      const mockRawCourse = {
        id: 100,
        title: 'Mastering English',
        teacherId: 30,
        lessons: [
          {
            id: 1,
            videoUrl: 'https://r2.dev/secret-video.mp4',
            materials: [
              { id: 101, fileUrl: 'https://r2.dev/secret-slides.pdf' },
            ],
          },
        ],
        classes: [{ id: 50, meetingLink: 'https://daily.co/secret-room-123' }],
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockRawCourse);

      const result = await service.getCourseById(100, 30, Role.TEACHER);

      expect(result.lessons[0].videoUrl).toBe(
        'https://r2.dev/secret-video.mp4',
      );
      expect(result.lessons[0].materials[0].fileUrl).toBe(
        'https://r2.dev/secret-slides.pdf',
      );
      expect(result.classes[0].meetingLink).toBe(
        'https://daily.co/secret-room-123',
      );
    });

    // 43. P3-PRE-02: Admin calls getCourseById -> receives full review data
    it('43. P3-PRE-02: Admin calls getCourseById -> receives full review data', async () => {
      const mockRawCourse = {
        id: 100,
        title: 'Mastering English',
        teacherId: 30,
        lessons: [
          {
            id: 1,
            videoUrl: 'https://r2.dev/secret-video.mp4',
            materials: [
              { id: 101, fileUrl: 'https://r2.dev/secret-slides.pdf' },
            ],
          },
        ],
        classes: [{ id: 50, meetingLink: 'https://daily.co/secret-room-123' }],
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockRawCourse);

      const result = await service.getCourseById(100, 1, Role.ADMIN);

      expect(result.lessons[0].videoUrl).toBe(
        'https://r2.dev/secret-video.mp4',
      );
      expect(result.lessons[0].materials[0].fileUrl).toBe(
        'https://r2.dev/secret-slides.pdf',
      );
      expect(result.classes[0].meetingLink).toBe(
        'https://daily.co/secret-room-123',
      );
    });

    // 44. P3-PRE-02: Teacher Non-Owner calls getCourseById -> receives sanitized overview
    it('44. P3-PRE-02: Teacher Non-Owner calls getCourseById -> receives sanitized overview', async () => {
      const mockRawCourse = {
        id: 100,
        title: 'Mastering English',
        teacherId: 30,
        lessons: [
          {
            id: 1,
            title: 'Lesson 1',
            videoUrl: 'https://r2.dev/secret-video.mp4',
            materials: [
              {
                id: 101,
                title: 'Slide.pdf',
                fileUrl: 'https://r2.dev/secret-slides.pdf',
              },
            ],
          },
        ],
        classes: [{ id: 50, meetingLink: 'https://daily.co/secret-room-123' }],
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockRawCourse);

      const result = await service.getCourseById(100, 99, Role.TEACHER); // Teacher 99 != Owner 30

      expect(result.lessons[0].videoUrl).toBeNull();
      expect(result.lessons[0].materials[0].fileUrl).toBeNull();
      expect(result.classes[0].meetingLink).toBeNull();
    });
  });

  describe('Phase 3A - Public Discovery & Catalog (P01 - P07)', () => {
    it('P01: getPublicCatalog queries only CourseStatus.PUBLISHED and returns safe cards with upcomingClassCount', async () => {
      const mockPublishedCourses = [
        {
          id: 501,
          title: 'Speaking Mastery',
          description: 'Master your spoken English',
          thumbnail: 'https://r2.dev/thumb1.jpg',
          level: 'INTERMEDIATE',
          createdAt: new Date('2026-03-01'),
          teacher: {
            id: 10,
            profile: {
              fullName: 'Sarah Connor',
              avatar: 'https://r2.dev/sarah.jpg',
            },
          },
          classes: [{ id: 1 }, { id: 2 }], // 2 upcoming classes
        },
      ];

      mockPrisma.course.findMany.mockResolvedValue(mockPublishedCourses);

      const result = await service.getPublicCatalog();

      expect(mockPrisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: CourseStatus.PUBLISHED },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(501);
      expect(result[0].title).toBe('Speaking Mastery');
      expect(result[0].upcomingClassCount).toBe(2);
      expect(result[0].teacher.fullName).toBe('Sarah Connor');
    });

    it('P02: getPublicCourseDetail returns sanitized curriculum outline (id, title, description, order)', async () => {
      const mockCourse = {
        id: 501,
        title: 'Speaking Mastery',
        description: 'Master your spoken English',
        thumbnail: 'https://r2.dev/thumb1.jpg',
        level: 'INTERMEDIATE',
        createdAt: new Date('2026-03-01'),
        teacher: {
          id: 10,
          profile: {
            fullName: 'Sarah Connor',
            avatar: null,
            targetScore: 'IELTS 8.0',
          },
        },
        lessons: [
          {
            id: 11,
            title: 'Unit 1: Small Talk',
            description: 'Basic conversational starters',
            order: 1,
          },
          {
            id: 12,
            title: 'Unit 2: Negotiation',
            description: 'Business talk',
            order: 2,
          },
        ],
        classes: [],
      };

      mockPrisma.course.findFirst.mockResolvedValue(mockCourse);

      const result = await service.getPublicCourseDetail(501);

      expect(result.id).toBe(501);
      expect(result.lessons).toHaveLength(2);
      expect(result.lessons[0]).toEqual({
        id: 11,
        title: 'Unit 1: Small Talk',
        description: 'Basic conversational starters',
        order: 1,
      });
      // Ensure no private videoUrl or materials in lesson outline
      expect((result.lessons[0] as any).videoUrl).toBeUndefined();
      expect((result.lessons[0] as any).materials).toBeUndefined();
    });

    it('P03: getPublicCourseDetail throws NotFoundException for unpublished courses or non-existent ID', async () => {
      mockPrisma.course.findFirst.mockResolvedValue(null);

      await expect(service.getPublicCourseDetail(999)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 999, status: CourseStatus.PUBLISHED },
        }),
      );
    });

    it('P04: getPublicCourseDetail includes UPCOMING classes with remaining seats calculated', async () => {
      const mockCourse = {
        id: 501,
        title: 'Speaking Mastery',
        description: 'Desc',
        thumbnail: null,
        level: 'BEGINNER',
        createdAt: new Date(),
        teacher: { id: 10, profile: { fullName: 'Sarah', avatar: null } },
        lessons: [],
        classes: [
          {
            id: 701,
            name: 'Class October',
            startDate: new Date('2026-10-01'),
            endDate: new Date('2026-12-01'),
            capacity: 25,
            status: ClassStatus.UPCOMING,
            teacher: { id: 10, profile: { fullName: 'Sarah', avatar: null } },
            enrollments: [{ id: 1 }, { id: 2 }, { id: 3 }], // 3 active enrollments
          },
        ],
      };

      mockPrisma.course.findFirst.mockResolvedValue(mockCourse);

      const result = await service.getPublicCourseDetail(501);

      expect(result.classes).toHaveLength(1);
      const cls = result.classes[0];
      expect(cls.id).toBe(701);
      expect(cls.capacity).toBe(25);
      expect(cls.currentEnrollmentCount).toBe(3);
      expect(cls.remainingSeats).toBe(22);
      expect(cls.isSoldOut).toBe(false);
    });

    it('P05: getPublicCourseDetail filters query so only UPCOMING classes are requested', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({
        id: 501,
        title: 'Course',
        classes: [],
        lessons: [],
      });

      await service.getPublicCourseDetail(501);

      expect(mockPrisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            classes: expect.objectContaining({
              where: { status: ClassStatus.UPCOMING },
            }),
          }),
        }),
      );
    });

    it('P06: getPublicCourseDetail zero private leak (no videoUrl, materials.fileUrl, meetingLink, or quizzes)', async () => {
      const mockCourse = {
        id: 501,
        title: 'Safe Course',
        description: 'Safe Desc',
        thumbnail: 'thumb.jpg',
        level: 'BEGINNER',
        createdAt: new Date(),
        teacher: { id: 10, profile: { fullName: 'Teacher' } },
        lessons: [{ id: 1, title: 'Lesson 1', description: 'Desc', order: 1 }],
        classes: [
          {
            id: 801,
            name: 'Upcoming Class',
            startDate: new Date(),
            endDate: new Date(),
            capacity: 20,
            status: ClassStatus.UPCOMING,
            teacher: { id: 10, profile: { fullName: 'Teacher' } },
            enrollments: [],
          },
        ],
      };

      mockPrisma.course.findFirst.mockResolvedValue(mockCourse);

      const result = await service.getPublicCourseDetail(501);

      expect((result as any).quizzes).toBeUndefined();
      expect((result.lessons[0] as any).videoUrl).toBeUndefined();
      expect((result.lessons[0] as any).materials).toBeUndefined();
      expect((result.classes[0] as any).meetingLink).toBeUndefined();
    });

    it('P07: getPublicCourseDetail calculates isSoldOut: true when active enrollments >= capacity', async () => {
      const mockCourse = {
        id: 501,
        title: 'Full Course',
        teacher: { id: 10, profile: { fullName: 'Teacher' } },
        lessons: [],
        classes: [
          {
            id: 901,
            name: 'Full Class',
            capacity: 2,
            status: ClassStatus.UPCOMING,
            teacher: { id: 10, profile: { fullName: 'Teacher' } },
            enrollments: [{ id: 1 }, { id: 2 }], // 2/2 full
          },
        ],
      };

      mockPrisma.course.findFirst.mockResolvedValue(mockCourse);

      const result = await service.getPublicCourseDetail(501);

      expect(result.classes[0].remainingSeats).toBe(0);
      expect(result.classes[0].isSoldOut).toBe(true);
    });
  });

  describe('Phase 3C-1 financial-history delete guards', () => {
    it('DEL-PAY-05: deletes a Course when no retained Payment exists', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 77,
        teacherId: 10,
        status: CourseStatus.DRAFT,
      });
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.course.delete.mockResolvedValue({ id: 77 });

      await expect(
        service.deleteCourse(77, { id: 10, role: Role.TEACHER }),
      ).resolves.toEqual({ id: 77 });
    });

    it('DEL-PAY-06: rejects Course deletion when retained Payment exists', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 77,
        teacherId: 10,
        status: CourseStatus.DRAFT,
      });
      mockPrisma.payment.count.mockResolvedValue(1);

      await expect(
        service.deleteCourse(77, { id: 10, role: Role.TEACHER }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.course.delete).not.toHaveBeenCalled();
      expect(mockPrisma.payment.count).toHaveBeenCalledWith({
        where: { enrollment: { class: { courseId: 77 } } },
      });
    });

    it('DEL-PAY-07: Class deletion remains blocked when Enrollment history exists', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({ id: 88, teacherId: 10 });
      mockPrisma.enrollment.count.mockResolvedValue(1);

      await expect(
        service.deleteClass(88, { id: 10, role: Role.TEACHER }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.class.delete).not.toHaveBeenCalled();
    });

    it('DEL-PAY-08: unrelated Payment does not block scoped Course deletion', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: 78,
        teacherId: 10,
        status: CourseStatus.DRAFT,
      });
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.course.delete.mockResolvedValue({ id: 78 });

      await service.deleteCourse(78, { id: 10, role: Role.TEACHER });
      expect(mockPrisma.payment.count).toHaveBeenCalledWith({
        where: { enrollment: { class: { courseId: 78 } } },
      });
    });
  });
});
