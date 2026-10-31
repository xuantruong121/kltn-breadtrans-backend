/* eslint-disable @typescript-eslint/require-await */
import { CourseService } from './course.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseStatus } from '@prisma/client';

describe('CourseService self-paced business rules', () => {
  const prisma = {
    course: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    class: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    lesson: {
      create: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    material: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    enrollment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    payment: { count: jest.fn(), create: jest.fn() },
    courseLesson: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  } as any;
  let service: CourseService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CourseService(prisma as PrismaService);
  });

  it('creates courses only for Admin and starts in DRAFT', async () => {
    prisma.course.create.mockResolvedValue({
      id: 1,
      status: CourseStatus.DRAFT,
    });
    await expect(
      service.createCourse({ title: 'TOEIC' }, { id: 1, role: 'ADMIN' }),
    ).resolves.toEqual(expect.objectContaining({ status: CourseStatus.DRAFT }));
    await expect(
      service.createCourse({ title: 'TOEIC' }, { id: 2, role: 'STUDENT' }),
    ).rejects.toThrow();
  });

  it('blocks publishing a course without a complete V5 lesson', async () => {
    prisma.courseLesson.findMany.mockResolvedValue([]);
    await expect(
      service.updateCourseStatus(1, CourseStatus.PUBLISHED),
    ).rejects.toThrow('chưa có bài học V5');
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  describe('startCourse', () => {
    const pro = { hasFeature: jest.fn().mockResolvedValue(true) } as any;
    const published = (lessons: unknown[]) => ({
      id: 1,
      status: CourseStatus.PUBLISHED,
      curriculumType: 'FOUR_SKILLS',
      lessons,
      quizzes: [],
      activities: [],
    });

    it('starts a published course that has published V5 lessons, even with an incomplete legacy curriculum', async () => {
      const withPro = new CourseService(prisma as PrismaService, pro);
      prisma.course.findUnique.mockResolvedValue(
        published([{ id: 1, order: 1, title: 'Legacy', materials: [] }]),
      );
      prisma.courseLesson.count.mockResolvedValue(8);
      await expect(
        withPro.startCourse(1, { id: 7, role: 'STUDENT' as any }),
      ).resolves.toEqual(
        expect.objectContaining({
          courseId: 1,
          accessSource: 'PRO_SUBSCRIPTION',
          learningPath: 'COURSE_LEARNING_V5',
        }),
      );
    });

    it('still refuses a legacy-only course whose curriculum is not ready', async () => {
      const withPro = new CourseService(prisma as PrismaService, pro);
      prisma.course.findUnique.mockResolvedValue(published([]));
      prisma.courseLesson.count.mockResolvedValue(0);
      await expect(
        withPro.startCourse(1, { id: 7, role: 'STUDENT' as any }),
      ).rejects.toThrow('chưa sẵn sàng');
    });

    it('still requires an active PRO plan', async () => {
      const noPro = new CourseService(
        prisma as PrismaService,
        {
          hasFeature: jest.fn().mockResolvedValue(false),
        } as any,
      );
      await expect(
        noPro.startCourse(1, { id: 7, role: 'STUDENT' as any }),
      ).rejects.toThrow('PRO');
      expect(prisma.courseLesson.count).not.toHaveBeenCalled();
    });
  });

  it('does not expose draft courses to students', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 9,
      status: CourseStatus.DRAFT,
    });

    await expect(service.getCourseById(9, 7, 'STUDENT')).rejects.toThrow(
      'Không tìm thấy khóa học.',
    );
    expect(prisma.course.findUnique).toHaveBeenCalledTimes(1);
  });

  it('allows publishing when published V5 lessons have required content', async () => {
    prisma.courseLesson.findMany.mockResolvedValue([
      {
        id: 1,
        title: 'Lesson 1',
        summary: 'Summary',
        learningObjectives: ['Objective'],
        status: 'PUBLISHED',
        sections: [{ id: 1, isRequired: true }],
        exercises: [{ required: true, questions: [{ id: 1 }] }],
      },
    ]);
    prisma.course.update.mockResolvedValue({
      id: 1,
      status: CourseStatus.PUBLISHED,
    });
    await expect(
      service.updateCourseStatus(1, CourseStatus.PUBLISHED),
    ).resolves.toEqual({ id: 1, status: CourseStatus.PUBLISHED });
  });
});
