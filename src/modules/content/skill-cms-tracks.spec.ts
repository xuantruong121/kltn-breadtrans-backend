import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { SkillCmsService } from './skill-cms.service';

const ADMIN = { id: 17, role: Role.ADMIN };

function setup(
  options: {
    quizTags?: Array<{ track: string }>;
    setTags?: Array<{ track: string }>;
    exercises?: Array<{ id: number; publicationStatus?: string }>;
    active?: string[];
  } = {},
) {
  const active = options.active ?? [
    'GENERAL',
    'IT_SOFTWARE',
    'OFFICE_BUSINESS',
  ];
  const prisma: any = {
    quiz: {
      findFirst: jest.fn().mockResolvedValue({
        id: 5,
        theoryContent: null,
        questions: [],
      }),
    },
    speakingPracticeSet: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'set-1',
        scope: 'SKILL_PRACTICE',
        exercises: options.exercises ?? [{ id: 40 }, { id: 41 }],
        tracks: options.setTags ?? [],
      }),
    },
    contentTrackTag: {
      findMany: jest.fn().mockResolvedValue(options.quizTags ?? []),
      deleteMany: jest.fn((args: unknown) => args),
      createMany: jest.fn((args: unknown) => args),
    },
    speakingSetTrack: {
      findMany: jest.fn().mockResolvedValue(options.setTags ?? []),
      deleteMany: jest.fn((args: unknown) => args),
      createMany: jest.fn((args: unknown) => args),
    },
    learningTrack: {
      findMany: jest.fn(({ where }: { where: { code: { in: string[] } } }) =>
        Promise.resolve(
          where.code.in
            .filter((code) => active.includes(code))
            .map((code) => ({ code })),
        ),
      ),
    },
    $transaction: jest.fn((steps: unknown[]) => Promise.all(steps)),
  };
  return { prisma, service: new SkillCmsService(prisma) };
}

describe('SkillCmsService.setTracks', () => {
  it('replaces the tags of a quiz', async () => {
    const { prisma, service } = setup({ quizTags: [{ track: 'IT_SOFTWARE' }] });
    const result = await service.setTracks(
      'listening',
      '5',
      ['IT_SOFTWARE'],
      ADMIN,
    );
    expect(prisma.contentTrackTag.deleteMany).toHaveBeenCalledWith({
      where: {
        contentType: 'QUIZ',
        contentId: 5,
        track: { notIn: ['IT_SOFTWARE'] },
      },
    });
    expect(prisma.contentTrackTag.createMany).toHaveBeenCalledWith({
      data: [
        {
          contentType: 'QUIZ',
          contentId: 5,
          track: 'IT_SOFTWARE',
          createdById: 17,
        },
      ],
      skipDuplicates: true,
    });
    expect(result).toEqual({ tracks: ['IT_SOFTWARE'] });
  });

  it('tags a speaking set by its own id, never through an exercise', async () => {
    const { prisma, service } = setup({ setTags: [] });
    await service.setTracks('speaking', 'set-1', ['GENERAL'], ADMIN);
    expect(prisma.speakingSetTrack.deleteMany).toHaveBeenCalledWith({
      where: { setId: 'set-1', track: { notIn: ['GENERAL'] } },
    });
    expect(prisma.speakingSetTrack.createMany).toHaveBeenCalledWith({
      data: [{ setId: 'set-1', track: 'GENERAL', createdById: 17 }],
      skipDuplicates: true,
    });
    expect(prisma.contentTrackTag.createMany).not.toHaveBeenCalled();
  });

  it('keeps the tags of a set whose first exercise is a new draft', async () => {
    const { prisma, service } = setup({
      exercises: [
        { id: 99, publicationStatus: 'DRAFT' },
        { id: 40, publicationStatus: 'PUBLISHED' },
      ],
      setTags: [{ track: 'OFFICE_BUSINESS' }],
    });
    const item = await service.get('speaking', 'set-1', ADMIN);
    expect(item.tracks).toEqual(['OFFICE_BUSINESS']);
    const saved = await service.setTracks(
      'speaking',
      'set-1',
      ['OFFICE_BUSINESS'],
      ADMIN,
    );
    expect(prisma.speakingSetTrack.createMany.mock.calls[0][0].data).toEqual([
      { setId: 'set-1', track: 'OFFICE_BUSINESS', createdById: 17 },
    ]);
    expect(saved).toEqual({ tracks: ['OFFICE_BUSINESS'] });
  });

  it('tags a set that has no exercise yet', async () => {
    const { prisma, service } = setup({ exercises: [] });
    await expect(
      service.setTracks('speaking', 'set-1', ['IT_SOFTWARE'], ADMIN),
    ).resolves.toBeDefined();
    expect(prisma.speakingSetTrack.createMany).toHaveBeenCalledWith({
      data: [{ setId: 'set-1', track: 'IT_SOFTWARE', createdById: 17 }],
      skipDuplicates: true,
    });
  });

  it('keeps an inactive tag the item has, but never adds one', async () => {
    const { prisma, service } = setup({
      setTags: [{ track: 'HOSPITALITY_TOURISM' }],
      active: ['GENERAL'],
    });
    await expect(
      service.setTracks(
        'speaking',
        'set-1',
        ['HOSPITALITY_TOURISM', 'GENERAL'],
        ADMIN,
      ),
    ).resolves.toBeDefined();
    expect(prisma.learningTrack.findMany).toHaveBeenCalledWith({
      where: { code: { in: ['GENERAL'] }, isActive: true },
      select: { code: true },
    });

    const quiz = setup({ active: ['GENERAL'] });
    await expect(
      quiz.service.setTracks('reading', '5', ['HOSPITALITY_TOURISM'], ADMIN),
    ).rejects.toThrow(BadRequestException);
    expect(quiz.prisma.contentTrackTag.createMany).not.toHaveBeenCalled();
  });

  it('refuses an unknown code', async () => {
    const { prisma, service } = setup();
    await expect(
      service.setTracks('speaking', 'set-1', ['NOT_A_TRACK'], ADMIN),
    ).rejects.toThrow('Lĩnh vực không tồn tại hoặc đã tắt: NOT_A_TRACK');
    expect(prisma.speakingSetTrack.createMany).not.toHaveBeenCalled();
  });

  it('clears every tag on an empty list without reading the tracks', async () => {
    const { prisma, service } = setup();
    await service.setTracks('reading', '5', [], ADMIN);
    expect(prisma.contentTrackTag.deleteMany).toHaveBeenCalledWith({
      where: { contentType: 'QUIZ', contentId: 5, track: { notIn: [] } },
    });
    expect(prisma.learningTrack.findMany).not.toHaveBeenCalled();
  });

  it('leaves an exam set alone', async () => {
    const { prisma, service } = setup();
    prisma.speakingPracticeSet.findUnique.mockResolvedValue({
      id: 'exam',
      scope: 'EXAM_INTERNAL',
      exercises: [{ id: 1 }],
      tracks: [],
    });
    await expect(
      service.setTracks('speaking', 'exam', ['GENERAL'], ADMIN),
    ).rejects.toThrow(NotFoundException);
  });

  it('is for admins', async () => {
    const { service } = setup();
    await expect(
      service.setTracks('reading', '5', [], { id: 1, role: Role.STUDENT }),
    ).rejects.toThrow('Chỉ quản trị viên được thực hiện thao tác này.');
  });
});

describe('SkillCmsService track lists', () => {
  it('reads speaking set tags from the set for the list page', async () => {
    const rows = [
      {
        id: 'set-a',
        title: 'A',
        description: '',
        level: 'INTERMEDIATE',
        publicationStatus: 'PUBLISHED',
        updatedAt: new Date('2026-11-01'),
        tracks: [{ track: 'IT_SOFTWARE' }],
        _count: { exercises: 0 },
      },
      {
        id: 'set-b',
        title: 'B',
        description: '',
        level: 'INTERMEDIATE',
        publicationStatus: 'DRAFT',
        updatedAt: new Date('2026-11-02'),
        tracks: [],
        _count: { exercises: 3 },
      },
    ];
    const prisma: any = {
      speakingPracticeSet: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(rows)
          .mockResolvedValueOnce([{ id: 'set-b', title: 'B', exercises: [] }]),
      },
    };
    const service = new SkillCmsService(prisma);
    const page = (await service.list('speaking', ADMIN, {
      page: '1',
      track: 'UNTAGGED',
    })) as { items: Array<{ id: string; tracks: string[] }> };
    expect(prisma.speakingPracticeSet.findMany.mock.calls[0][0].select).toEqual(
      expect.objectContaining({
        tracks: expect.objectContaining({ select: { track: true } }),
      }),
    );
    expect(page.items).toEqual([
      expect.objectContaining({ id: 'set-b', tracks: [] }),
    ]);
  });
});
