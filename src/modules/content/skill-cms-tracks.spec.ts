import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { SkillCmsService } from './skill-cms.service';

const ADMIN = { id: 17, role: Role.ADMIN };

function setup(stored: Array<{ track: string }> = []) {
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
        exercises: [{ id: 40 }, { id: 41 }],
      }),
    },
    contentTrackTag: {
      findMany: jest.fn().mockResolvedValue(stored),
      deleteMany: jest.fn((args: unknown) => args),
      createMany: jest.fn((args: unknown) => args),
    },
    $transaction: jest.fn((steps: unknown[]) => Promise.all(steps)),
  };
  return { prisma, service: new SkillCmsService(prisma) };
}

describe('SkillCmsService.setTracks', () => {
  it('replaces the tags of a quiz', async () => {
    const { prisma, service } = setup([{ track: 'IT_SOFTWARE' }]);
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

  it('keys a speaking set by its first exercise, as recommendations do', async () => {
    const { prisma, service } = setup();
    await service.setTracks('speaking', 'set-1', ['GENERAL'], ADMIN);
    expect(prisma.contentTrackTag.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({ contentType: 'SPEAKING_SET', contentId: 40 }),
    );
  });

  it('clears every tag on an empty list', async () => {
    const { prisma, service } = setup();
    await service.setTracks('reading', '5', [], ADMIN);
    expect(prisma.contentTrackTag.deleteMany).toHaveBeenCalledWith({
      where: { contentType: 'QUIZ', contentId: 5, track: { notIn: [] } },
    });
  });

  it('leaves an exam set alone', async () => {
    const { prisma, service } = setup();
    prisma.speakingPracticeSet.findUnique.mockResolvedValue({
      id: 'exam',
      scope: 'EXAM_INTERNAL',
      exercises: [{ id: 1 }],
    });
    await expect(
      service.setTracks('speaking', 'exam', ['GENERAL'], ADMIN),
    ).rejects.toThrow(NotFoundException);
  });

  it('is for admins', async () => {
    const { service } = setup();
    await expect(
      service.setTracks('reading', '5', [], { id: 1, role: Role.STUDENT }),
    ).rejects.toThrow('Admin only');
  });
});
