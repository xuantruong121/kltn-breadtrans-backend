import { Test, TestingModule } from '@nestjs/testing';
import { CoursePublicController } from './course-public.controller';
import { CourseService } from './course.service';

describe('CoursePublicController (Routing & Delegation)', () => {
  let controller: CoursePublicController;
  let service: jest.Mocked<Partial<CourseService>>;

  beforeEach(async () => {
    service = {
      getPublicCatalog: jest.fn().mockResolvedValue([
        {
          id: 101,
          title: 'IELTS Masterclass',
          description: 'Top notch IELTS course',
          thumbnail: 'https://r2.dev/thumb.jpg',
          level: 'ADVANCED',
          createdAt: new Date('2026-01-01'),
          teacher: { id: 5, fullName: 'Mr. David', avatar: null },
          upcomingClassCount: 2,
        },
      ]),
      getPublicCourseDetail: jest.fn().mockResolvedValue({
        id: 101,
        title: 'IELTS Masterclass',
        description: 'Top notch IELTS course',
        thumbnail: 'https://r2.dev/thumb.jpg',
        level: 'ADVANCED',
        createdAt: new Date('2026-01-01'),
        teacher: {
          id: 5,
          fullName: 'Mr. David',
          avatar: null,
          specialization: 'IELTS 8.5',
        },
        lessons: [
          { id: 1, title: 'Introduction', description: 'Intro', order: 1 },
        ],
        classes: [
          {
            id: 201,
            name: 'Class A',
            startDate: new Date('2026-10-01'),
            endDate: new Date('2026-12-01'),
            capacity: 30,
            currentEnrollmentCount: 5,
            remainingSeats: 25,
            isSoldOut: false,
            status: 'UPCOMING',
            teacher: { id: 5, fullName: 'Mr. David', avatar: null },
          },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoursePublicController],
      providers: [
        {
          provide: CourseService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<CoursePublicController>(CoursePublicController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getPublicCatalog delegates to courseService.getPublicCatalog with no user context needed', async () => {
    const result = await controller.getPublicCatalog();
    expect(service.getPublicCatalog).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(101);
    expect(result[0].upcomingClassCount).toBe(2);
  });

  it('getPublicCourseDetail delegates to courseService.getPublicCourseDetail with numeric id', async () => {
    const result = await controller.getPublicCourseDetail(101);
    expect(service.getPublicCourseDetail).toHaveBeenCalledWith(101);
    expect(result.id).toBe(101);
    expect(result.lessons).toHaveLength(1);
    expect(result.classes).toHaveLength(1);
  });
});
