/* eslint-disable @typescript-eslint/no-unsafe-call */
import { ClassService } from './class.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ClassService self-paced access', () => {
  const prisma = {
    class: { findUnique: jest.fn() },
    enrollment: { findMany: jest.fn(), updateMany: jest.fn() },
    lesson: { findFirst: jest.fn(), findMany: jest.fn() },
    watchTracking: { findUnique: jest.fn(), upsert: jest.fn() },
  } as any;
  let service: ClassService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClassService(prisma as PrismaService);
  });

  it('denies private offering access without ACTIVE/COMPLETED enrollment', async () => {
    prisma.class.findUnique.mockResolvedValue({
      id: 1,
      enrollments: [{ userId: 7, status: 'PENDING_PAYMENT' }],
      course: { lessons: [] },
      assignments: [],
    });
    await expect(service.getClassDetail(1, 7, 'STUDENT')).rejects.toThrow();
  });

  it('returns self-paced offering for ACTIVE enrollment without live fields', async () => {
    prisma.class.findUnique.mockResolvedValue({
      id: 1,
      enrollments: [{ userId: 7, status: 'ACTIVE' }],
      course: { lessons: [] },
      assignments: [],
    });
    const result = await service.getClassDetail(1, 7, 'STUDENT');
    expect(result).toEqual(expect.objectContaining({ id: 1 }));
    expect(result).not.toHaveProperty('sessions');
  });

  it('stores watch progress under the selected offering and updates only that enrollment', async () => {
    prisma.lesson.findFirst.mockResolvedValue({ id: 9, courseId: 5 });
    prisma.enrollment.findMany.mockResolvedValue([
      { id: 20, classId: 11, class: { courseId: 5 } },
    ]);
    prisma.watchTracking.findUnique.mockResolvedValue({ items: {} });
    prisma.lesson.findMany.mockResolvedValue([
      { videoUrl: 'lesson-1' },
      { videoUrl: 'lesson-2' },
    ]);
    prisma.watchTracking.upsert.mockResolvedValue({});

    const result = await service.updateWatchTracking(7, 11, 'lesson-1', 0.95);

    expect(prisma.watchTracking.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          items: {
            'class:11:lesson-1': expect.objectContaining({ played: 0.95 }),
          },
        },
      }),
    );
    expect(prisma.enrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classId: 11 }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ classId: 11, progress: 50 }),
    );
  });

  it('requires classId when the student has multiple offerings for one course', async () => {
    prisma.lesson.findFirst.mockResolvedValue({ id: 9, courseId: 5 });
    prisma.enrollment.findMany.mockResolvedValue([
      { id: 20, classId: 11, class: { courseId: 5 } },
      { id: 21, classId: 12, class: { courseId: 5 } },
    ]);

    await expect(
      service.updateWatchTracking(7, undefined, 'lesson-1', 0.5),
    ).rejects.toThrow('classId là bắt buộc');
  });
});
