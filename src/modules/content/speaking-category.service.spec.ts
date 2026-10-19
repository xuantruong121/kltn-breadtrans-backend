import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  normalizeSpeakingCategoryCode,
  SpeakingCategoryService,
} from './speaking-category.service';

describe('SpeakingCategoryService', () => {
  const baseCategory = {
    id: 1,
    code: 'BUSINESS',
    name: 'Công việc',
    nameNormalized: 'cong viec',
    description: null,
    isActive: true,
    sortOrder: 30,
    allowPracticeSet: true,
    allowExercise: true,
  };

  function createService(overrides: Record<string, jest.Mock> = {}) {
    const prisma = {
      speakingCategory: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        ...overrides,
      },
    } as any;
    return { prisma, service: new SpeakingCategoryService(prisma) };
  }

  it('normalizes Vietnamese category codes into stable taxonomy keys', () => {
    expect(normalizeSpeakingCategoryCode(' đời sống hằng ngày ')).toBe(
      'DOI_SONG_HANG_NGAY',
    );
    expect(() => normalizeSpeakingCategoryCode('---')).toThrow(
      BadRequestException,
    );
  });

  it('rejects duplicate category creation from Prisma unique constraints', async () => {
    const { prisma, service } = createService();
    prisma.speakingCategory.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.create({ name: 'Công việc', code: 'BUSINESS' }),
    ).rejects.toThrow(ConflictException);
  });

  it('keeps category codes immutable even when the category is unused', async () => {
    const { prisma, service } = createService();
    prisma.speakingCategory.findUnique
      .mockResolvedValueOnce(baseCategory)
      .mockResolvedValueOnce({
        ...baseCategory,
        _count: { practiceSets: 0, exercises: 0 },
      });

    await expect(service.update(1, { code: 'WORKPLACE' })).rejects.toThrow(
      'bất biến',
    );
    expect(prisma.speakingCategory.update).not.toHaveBeenCalled();
  });

  it('blocks deletion when a category is referenced by content', async () => {
    const { prisma, service } = createService();
    prisma.speakingCategory.findUnique
      .mockResolvedValueOnce(baseCategory)
      .mockResolvedValueOnce({
        ...baseCategory,
        _count: { practiceSets: 1, exercises: 0 },
      });

    await expect(service.remove(1)).rejects.toThrow(ConflictException);
    expect(prisma.speakingCategory.delete).not.toHaveBeenCalled();
  });

  it('lists only categories in the requested authoring scope', async () => {
    const { prisma, service } = createService();
    prisma.speakingCategory.findMany.mockResolvedValue([baseCategory]);

    await service.list({ scope: 'exercise' });

    expect(prisma.speakingCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, allowExercise: true },
      }),
    );
  });
});
