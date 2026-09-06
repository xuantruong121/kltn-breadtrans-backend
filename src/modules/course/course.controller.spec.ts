import { Test, TestingModule } from '@nestjs/testing';
import { CourseController } from './course.controller';
import { CourseService } from './course.service';
import { Role } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('CourseController - Self-Enrollment & Controller Layer Spec', () => {
  let controller: CourseController;
  let service: jest.Mocked<Partial<CourseService>>;
  let reflector: Reflector;

  beforeEach(async () => {
    reflector = new Reflector();
    service = {
      enrollInClass: jest.fn().mockResolvedValue({
        enrollmentId: 101,
        classId: 23,
        status: 'ACTIVE',
        tuitionFeeVnd: 0,
        accessGranted: true,
        message: 'Ghi danh thành công.',
      }),
      getMyEnrollmentsInCourse: jest.fn().mockResolvedValue([
        {
          id: 1,
          classId: 23,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourseController],
      providers: [
        {
          provide: CourseService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<CourseController>(CourseController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('enrollInClass Delegation & Role Metadata', () => {
    it('1. req.user.id is correctly passed to service.enrollInClass', async () => {
      const mockReq = { user: { id: 77, role: Role.STUDENT } };
      const classId = 23;

      const result = await controller.enrollInClass(classId, mockReq);

      expect(service.enrollInClass).toHaveBeenCalledWith(23, 77);
      expect(result.status).toBe('ACTIVE');
    });

    it('2. enrollInClass has @Roles(Role.STUDENT) metadata', () => {
      const roles = reflector.get<Role[]>(
        ROLES_KEY,
        CourseController.prototype.enrollInClass,
      );
      expect(roles).toEqual([Role.STUDENT]);
    });

    it('3. getMyEnrollmentsInCourse passes courseId and req.user.id', async () => {
      const mockReq = { user: { id: 77, role: Role.STUDENT } };
      const courseId = 5;

      const result = await controller.getMyEnrollmentsInCourse(
        courseId,
        mockReq,
      );

      expect(service.getMyEnrollmentsInCourse).toHaveBeenCalledWith(5, 77);
      expect(result).toHaveLength(1);
    });

    it('4. getMyEnrollmentsInCourse has @Roles(Role.STUDENT) metadata', () => {
      const roles = reflector.get<Role[]>(
        ROLES_KEY,
        CourseController.prototype.getMyEnrollmentsInCourse,
      );
      expect(roles).toEqual([Role.STUDENT]);
    });
  });
});
