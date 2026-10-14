import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CourseV5AdminService } from './course-v5-admin.service';

describe('CourseV5AdminService', () => {
  const prisma = {
    course: { findUnique: jest.fn(), update: jest.fn() },
    courseLesson: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    courseLessonSection: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    courseLessonMedia: {
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    courseLessonExercise: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    courseLessonQuestion: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    courseLessonAttempt: { count: jest.fn() },
    courseLessonExerciseAnswer: { count: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const courseService = { reviewCourse: jest.fn() } as any;
  const upload = {
    getPresignedUploadUrl: jest.fn(),
    getPublicAssetUrl: jest.fn(),
  } as any;
  const service = new CourseV5AdminService(prisma, courseService, upload);

  beforeEach(() => jest.clearAllMocks());

  it('rejects non-admin access before touching V5 records', async () => {
    await expect(
      service.getStudio(99, { id: 1, role: Role.STUDENT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
  });

  it('reads the same nested V5 graph used by the learner runtime', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 9,
      title: 'QA',
      status: 'DRAFT',
    });
    prisma.courseLesson.findMany.mockResolvedValue([
      { id: 1, sections: [], media: [], exercises: [] },
    ]);
    const result = await service.getStudio(9, { id: 1, role: Role.ADMIN });
    expect(result.lessons[0].id).toBe(1);
    expect(prisma.courseLesson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: 9 },
        include: expect.objectContaining({
          sections: expect.any(Object),
          exercises: expect.any(Object),
          media: true,
        }),
      }),
    );
  });
});
