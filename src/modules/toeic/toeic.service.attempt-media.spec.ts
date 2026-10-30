import { AttemptStatus } from '@prisma/client';

import { ToeicService } from './toeic.service';

/**
 * The attempt payload carries no clip storage URL: the player fetches each
 * clip through GET /toeic/groups/:id/audio, which checks the attempt.
 */
describe('TOEIC attempt detail media', () => {
  it('does not select or return group audioUrl', async () => {
    const row = {
      id: 7,
      userId: 3,
      status: AttemptStatus.IN_PROGRESS,
      deadline: new Date(Date.now() + 3_600_000),
      section: null,
      selectedParts: [],
      markedQuestionIds: [],
      exam: {
        id: 1,
        groups: [
          {
            id: 10,
            part: 1,
            imageUrl: null,
            passageText: null,
            questions: [],
          },
        ],
      },
    };
    const prisma: any = {
      toeicAttempt: { findUnique: jest.fn().mockResolvedValue(row) },
    };
    const service = new ToeicService(prisma, {} as any);

    const out = await service.getAttemptDetail(7, 3);

    const select = prisma.toeicAttempt.findUnique.mock.calls[1][0].select;
    expect(select.exam.select.groups.select).not.toHaveProperty('audioUrl');
    expect(JSON.stringify(out)).not.toContain('audioUrl');
  });
});
