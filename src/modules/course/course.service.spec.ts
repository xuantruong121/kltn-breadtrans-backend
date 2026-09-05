import { Test, TestingModule } from '@nestjs/testing';
import { CourseService } from './course.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { Role, CourseStatus, ClassStatus, EnrollmentStatus } from '@prisma/client';
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
    $transaction: jest.fn((promises) =>
      Array.isArray(promises) ? Promise.all(promises) : promises,
    ),
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
  describe('Enrollment Business Rules', () => {
    // 17. Student enroll thành công
    it('17. Student enroll thành công', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        status: ClassStatus.UPCOMING,
        capacity: 30,
        _count: { enrollments: 5 },
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue(null); // Chưa enroll
      mockPrisma.enrollment.create.mockResolvedValue({
        id: 201,
        userId: 100,
        classId: 1,
        status: EnrollmentStatus.ACTIVE,
      });

      const result = await service.enrollInClass(1, 100);

      expect(result.status).toBe(EnrollmentStatus.ACTIVE);
      expect(mockPrisma.enrollment.create).toHaveBeenCalled();
    });

    // 18. Student enroll trùng -> bị từ chối 409
    it('18. Student enroll trùng -> bị từ chối 409 Conflict', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        status: ClassStatus.UPCOMING,
        capacity: 30,
        _count: { enrollments: 5 },
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 201,
        userId: 100,
        classId: 1,
      }); // Đã tồn tại

      await expect(service.enrollInClass(1, 100)).rejects.toThrow(
        ConflictException,
      );
    });

    // 19. Class full -> bị từ chối nếu có capacity
    it('19. Class full capacity -> bị từ chối 400', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        status: ClassStatus.UPCOMING,
        capacity: 10,
        _count: { enrollments: 10 }, // Đã đầy 10/10
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.enrollInClass(1, 101)).rejects.toThrow(
        BadRequestException,
      );
    });

    // 20. Enroll vào Class CANCELLED -> bị từ chối
    it('20. Enroll vào Class CANCELLED -> bị từ chối 400', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 1,
        status: ClassStatus.CANCELLED, // Lớp đã bị hủy
        capacity: 30,
        _count: { enrollments: 2 },
      });

      await expect(service.enrollInClass(1, 102)).rejects.toThrow(
        BadRequestException,
      );
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
      ).rejects.toThrow('Khóa học đang chờ Admin duyệt và không thể chuyển về Bản nháp.');
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
        service.updateCourse(1, { title: 'New Title' }, { id: 10, role: Role.TEACHER }),
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
        service.createLesson(1, { id: 10, role: Role.TEACHER }, { title: 'Lesson 1' }),
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
        service.createLesson(1, { id: 10, role: Role.TEACHER }, { title: 'Lesson 1' }),
      ).rejects.toThrow(BadRequestException);
    });

    // 27. Teacher sửa lesson của Teacher khác -> 403
    it('27. Teacher sửa lesson của Teacher khác -> 403 Forbidden', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        id: 5,
        course: { teacherId: 99, status: CourseStatus.DRAFT },
      });

      await expect(
        service.updateLesson(5, { id: 10, role: Role.TEACHER }, { title: 'Updated' }),
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
        service.updateClass(1, { id: 10, role: Role.TEACHER }, { capacity: 20 }),
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
        service.updateClass(1, { id: 10, role: Role.TEACHER }, { name: 'New Name' }),
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
        service.updateClass(1, { id: 10, role: Role.TEACHER }, { teacherId: 99 }),
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
  });
});
