import { Test, TestingModule } from '@nestjs/testing';
import { CourseController } from './course.controller';
import { CourseService } from './course.service';
import { CourseLearningV5Service } from './course-v5.service';

describe('CourseController - product routes', () => {
  let controller: CourseController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourseController],
      providers: [
        {
          provide: CourseService,
          useValue: {},
        },
        {
          provide: CourseLearningV5Service,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<CourseController>(CourseController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('does not expose legacy class enrollment handlers', () => {
    expect('enrollInClass' in controller).toBe(false);
    expect('getMyEnrollmentsInCourse' in controller).toBe(false);
  });
});
