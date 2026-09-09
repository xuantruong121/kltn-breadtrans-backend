/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { CourseService } from './course.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseStatus, ClassStatus, EnrollmentStatus } from '@prisma/client';

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

  it('rejects offering creation for a non-published course', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 1,
      status: CourseStatus.DRAFT,
    });
    await expect(
      service.createClass(1, { id: 1, role: 'ADMIN' }, { name: 'Open' }),
    ).rejects.toThrow();
  });

  it('keeps paid enrollment pending and creates a Payment atomically', async () => {
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 1,
            status: ClassStatus.UPCOMING,
            capacity: 10,
            tuitionFeeVnd: 100000,
          },
        ]),
        enrollment: {
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({
            id: 9,
            classId: 1,
            status: EnrollmentStatus.PENDING_PAYMENT,
          }),
        },
        payment: { create: jest.fn().mockResolvedValue({ id: 2 }) },
      }),
    );
    const result = await service.enrollInClass(1, 7);
    expect(result.status).toBe('PENDING_PAYMENT');
  });
});
