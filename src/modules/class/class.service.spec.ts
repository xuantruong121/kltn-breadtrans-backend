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
});
