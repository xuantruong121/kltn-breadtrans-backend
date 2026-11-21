import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { LearningTrackService } from './learning-track.service';

const track = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  name: code === 'GENERAL' ? 'Chung' : `Track ${code}`,
  nameNormalized: code.toLowerCase(),
  description: null,
  sortOrder: 10,
  isActive: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...extra,
});

function setup(stored = [track('IT_SOFTWARE'), track('GENERAL')]) {
  const prisma: any = {
    learningTrack: {
      findMany: jest.fn().mockResolvedValue(stored),
      findUnique: jest.fn(({ where }: { where: { code: string } }) =>
        Promise.resolve(stored.find((t) => t.code === where.code) ?? null),
      ),
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ ...track('NEW'), ...data }),
      ),
      update: jest.fn((args: unknown) => Promise.resolve(args)),
      delete: jest.fn().mockResolvedValue({}),
    },
    contentTrackTag: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    speakingSetTrack: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    learnerProfile: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    quiz: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((work: unknown) =>
      typeof work === 'function'
        ? (work as (tx: unknown) => unknown)(prisma)
        : Promise.all(work as unknown[]),
    ),
  };
  return { prisma, service: new LearningTrackService(prisma) };
}

describe('LearningTrackService', () => {
  it('lists active tracks for learners in the admin order', async () => {
    const { prisma, service } = setup();
    await service.listActive();
    expect(prisma.learningTrack.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { code: true, name: true, description: true, sortOrder: true },
    });
  });

  it('lists every track for admins with usage per skill and learners', async () => {
    const { prisma, service } = setup([
      track('IT_SOFTWARE', { isActive: false }),
      track('GENERAL'),
    ]);
    prisma.contentTrackTag.findMany.mockResolvedValue([
      { contentId: 1, track: 'IT_SOFTWARE' },
      { contentId: 2, track: 'IT_SOFTWARE' },
      { contentId: 3, track: 'GENERAL' },
    ]);
    prisma.quiz.findMany.mockResolvedValue([
      { id: 1, type: 'LISTENING_PRACTICE' },
      { id: 2, type: 'WRITING_EMAIL' },
      { id: 3, type: 'BILINGUAL_READING' },
    ]);
    prisma.speakingSetTrack.groupBy.mockResolvedValue([
      { track: 'GENERAL', _count: { _all: 7 } },
    ]);
    prisma.learnerProfile.groupBy.mockResolvedValue([
      { track: 'GENERAL', _count: { _all: 2 } },
    ]);
    const rows = await service.listForAdmin();
    expect(prisma.contentTrackTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contentType: 'QUIZ' } }),
    );
    expect(rows).toEqual([
      {
        code: 'IT_SOFTWARE',
        name: 'Track IT_SOFTWARE',
        description: null,
        sortOrder: 10,
        isActive: false,
        isSystem: false,
        usage: {
          listening: 1,
          reading: 0,
          writing: 1,
          speaking: 0,
          learners: 0,
        },
      },
      expect.objectContaining({
        code: 'GENERAL',
        isSystem: true,
        usage: {
          listening: 0,
          reading: 1,
          writing: 0,
          speaking: 7,
          learners: 2,
        },
      }),
    ]);
  });

  describe('create', () => {
    it('makes the code from the name and places it before GENERAL', async () => {
      const { prisma, service } = setup([
        track('IT_SOFTWARE', { sortOrder: 50 }),
        track('GENERAL', { sortOrder: 1000 }),
      ]);
      const created = await service.create({ name: ' Y tế – Điều dưỡng ' });
      expect(prisma.learningTrack.create).toHaveBeenCalledWith({
        data: {
          code: 'Y_TE_DIEU_DUONG',
          name: 'Y tế – Điều dưỡng',
          nameNormalized: 'y te – dieu duong',
          description: null,
          sortOrder: 60,
        },
      });
      expect(prisma.learningTrack.update).not.toHaveBeenCalled();
      expect(created).toMatchObject({
        code: 'Y_TE_DIEU_DUONG',
        isSystem: false,
        usage: { listening: 0, speaking: 0, learners: 0 },
      });
    });

    it('moves GENERAL down to keep it last', async () => {
      const { prisma, service } = setup([
        track('IT_SOFTWARE', { sortOrder: 10 }),
        track('GENERAL', { sortOrder: 20 }),
      ]);
      await service.create({ name: 'Y tế', code: 'y-te' });
      expect(prisma.learningTrack.create.mock.calls[0][0].data).toMatchObject({
        code: 'Y_TE',
        sortOrder: 20,
      });
      expect(prisma.learningTrack.update).toHaveBeenCalledWith({
        where: { code: 'GENERAL' },
        data: { sortOrder: 30 },
      });
    });

    it('answers 409 on a duplicate code or name', async () => {
      const { prisma, service } = setup();
      prisma.learningTrack.create.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['nameNormalized'] },
      });
      await expect(service.create({ name: 'Chung' })).rejects.toThrow(
        'Tên lĩnh vực đã có.',
      );
      prisma.learningTrack.create.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['code'] },
      });
      await expect(
        service.create({ name: 'Khác', code: 'GENERAL' }),
      ).rejects.toThrow('Mã lĩnh vực đã có.');
    });

    it('refuses a code that is empty once normalised', async () => {
      const { service } = setup();
      await expect(
        service.create({ name: 'Y tế', code: '***' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('renames and edits the description', async () => {
      const { prisma, service } = setup();
      await service.update('GENERAL', {
        name: 'Tổng quát',
        description: '  ',
      });
      expect(prisma.learningTrack.update).toHaveBeenCalledWith({
        where: { code: 'GENERAL' },
        data: {
          name: 'Tổng quát',
          nameNormalized: 'tong quat',
          description: null,
        },
      });
    });

    it('never changes a code', async () => {
      const { prisma, service } = setup();
      await expect(
        service.update('IT_SOFTWARE', { code: 'IT' }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.update('GENERAL', { code: 'CHUNG' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.learningTrack.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown track and 409 for a taken name', async () => {
      const { prisma, service } = setup();
      await expect(service.update('NOPE', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      prisma.learningTrack.update.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['nameNormalized'] },
      });
      await expect(
        service.update('IT_SOFTWARE', { name: 'Chung' }),
      ).rejects.toThrow('Tên lĩnh vực đã có.');
    });
  });

  describe('reorder', () => {
    it('numbers every track 10, 20, ... in the given order', async () => {
      const { prisma, service } = setup();
      await service.reorder(['GENERAL', 'IT_SOFTWARE']);
      expect(prisma.learningTrack.update.mock.calls).toEqual([
        [{ where: { code: 'GENERAL' }, data: { sortOrder: 10 } }],
        [{ where: { code: 'IT_SOFTWARE' }, data: { sortOrder: 20 } }],
      ]);
    });

    it('refuses a list that is not every code once', async () => {
      const { prisma, service } = setup();
      await expect(service.reorder(['GENERAL'])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.reorder(['GENERAL', 'GENERAL']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.learningTrack.update).not.toHaveBeenCalled();
    });
  });

  describe('activate and deactivate', () => {
    it('deactivates a track and turns it back on', async () => {
      const { prisma, service } = setup();
      await service.setActive('IT_SOFTWARE', false);
      await service.setActive('IT_SOFTWARE', true);
      expect(prisma.learningTrack.update.mock.calls).toEqual([
        [{ where: { code: 'IT_SOFTWARE' }, data: { isActive: false } }],
        [{ where: { code: 'IT_SOFTWARE' }, data: { isActive: true } }],
      ]);
    });

    it('never deactivates GENERAL', async () => {
      const { prisma, service } = setup();
      await expect(service.setActive('GENERAL', false)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.learningTrack.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an unused track', async () => {
      const { prisma, service } = setup();
      await expect(service.remove('IT_SOFTWARE')).resolves.toEqual({
        code: 'IT_SOFTWARE',
        deleted: true,
      });
      expect(prisma.learningTrack.delete).toHaveBeenCalledWith({
        where: { code: 'IT_SOFTWARE' },
      });
    });

    it('refuses GENERAL and a track in use', async () => {
      const { prisma, service } = setup();
      await expect(service.remove('GENERAL')).rejects.toBeInstanceOf(
        ConflictException,
      );
      prisma.speakingSetTrack.count.mockResolvedValueOnce(1);
      await expect(service.remove('IT_SOFTWARE')).rejects.toThrow(
        /đang được gắn/,
      );
      prisma.learnerProfile.count.mockResolvedValueOnce(3);
      await expect(service.remove('IT_SOFTWARE')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.learningTrack.delete).not.toHaveBeenCalled();
    });

    it('turns a foreign key failure into 409', async () => {
      const { prisma, service } = setup();
      prisma.learningTrack.delete.mockRejectedValueOnce({ code: 'P2003' });
      await expect(service.remove('IT_SOFTWARE')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
