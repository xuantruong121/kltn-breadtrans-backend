import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CourseV5AdminService } from './course-v5-admin.service';

const admin = { id: 1, role: Role.ADMIN };

const baseLesson = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 10,
  courseId: 9,
  title: 'Daily routines',
  summary: 'Practice present simple.',
  learningObjectives: ['Describe daily routines'],
  requiresFinalCheck: true,
  status: 'DRAFT',
  sections: [{ id: 1, isRequired: true }],
  exercises: [] as Array<{
    id: number;
    slug: string;
    required: boolean;
    title: string;
    questions: unknown[];
  }>,
  ...overrides,
});

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

  describe('Final Check requirement — requiresFinalCheck', () => {
    it('requires Final Check for a lesson with requiresFinalCheck: true (default) and none exists', async () => {
      const lesson = baseLesson();
      prisma.courseLesson.findFirst.mockResolvedValue(lesson);
      prisma.courseLesson.findUnique.mockResolvedValue(lesson);
      const result = await service.validateLesson(9, 10, admin);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Thiếu Kiểm tra cuối bài');
    });

    it('does NOT require Final Check when requiresFinalCheck is false and none exists', async () => {
      const lesson = baseLesson({ requiresFinalCheck: false });
      prisma.courseLesson.findFirst.mockResolvedValue(lesson);
      prisma.courseLesson.findUnique.mockResolvedValue(lesson);
      const result = await service.validateLesson(9, 10, admin);
      expect(result.valid).toBe(true);
      expect(result.errors).not.toContain('Thiếu Kiểm tra cuối bài');
    });

    it('still flags an existing-but-empty Final Check even when requiresFinalCheck is false', async () => {
      const lesson = baseLesson({
        requiresFinalCheck: false,
        exercises: [
          {
            id: 1,
            slug: 'final-check',
            required: true,
            title: 'Final check',
            questions: [],
          },
        ],
      });
      prisma.courseLesson.findFirst.mockResolvedValue(lesson);
      prisma.courseLesson.findUnique.mockResolvedValue(lesson);
      const result = await service.validateLesson(9, 10, admin);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Kiểm tra cuối bài chưa có câu hỏi');
    });

    it('lets publishLesson succeed for a requiresFinalCheck: false lesson with no Final Check', async () => {
      const lesson = baseLesson({ requiresFinalCheck: false });
      prisma.courseLesson.findFirst.mockResolvedValue(lesson);
      prisma.courseLesson.findUnique.mockResolvedValue(lesson);
      prisma.courseLesson.update.mockResolvedValue({
        ...lesson,
        status: 'PUBLISHED',
      });
      await expect(service.publishLesson(9, 10, admin)).resolves.toMatchObject({
        status: 'PUBLISHED',
      });
    });

    it('validateCourse applies the same requiresFinalCheck exemption per lesson', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 9, status: 'DRAFT' });
      prisma.courseLesson.findMany.mockResolvedValue([
        baseLesson({ id: 10, requiresFinalCheck: false, status: 'PUBLISHED' }),
        baseLesson({
          id: 11,
          requiresFinalCheck: true,
          exercises: [
            {
              id: 2,
              slug: 'final-check',
              required: true,
              title: 'Final check',
              questions: [{ id: 1 }],
            },
          ],
        }),
      ]);
      const result = await service.validateCourse(9, admin);
      expect(result.valid).toBe(true);
    });

    it('validateCourse still reports a missing Final Check for a lesson that requires one', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 9, status: 'DRAFT' });
      prisma.courseLesson.findMany.mockResolvedValue([
        baseLesson({ id: 10, requiresFinalCheck: true, status: 'PUBLISHED' }),
      ]);
      const result = await service.validateCourse(9, admin);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Bài học #10: thiếu Kiểm tra cuối bài');
    });
  });
});
