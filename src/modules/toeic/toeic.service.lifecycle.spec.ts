import { NotFoundException } from '@nestjs/common';
import { QuizPublicationStatus } from '@prisma/client';
import { ToeicService } from './toeic.service';

describe('ToeicService learner publication boundary', () => {
  it('projects every semantic field required by the listening readiness validator in learner briefing', async () => {
    const prisma: any = {
      toeicExamSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 302,
          publicationStatus: QuizPublicationStatus.PUBLISHED,
          type: 'PRACTICE_BY_PART',
          durationSeconds: 600,
          groups: [],
        }),
      },
      toeicAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ToeicService(prisma, {} as any);

    await service.getExamBriefing(302, 7);

    const select = prisma.toeicExamSet.findUnique.mock.calls[0][0].include.groups.select;
    expect(select).toEqual(expect.objectContaining({
      canonicalAccent: true,
      transcriptText: true,
      imageBrief: true,
      mediaMetadata: true,
    }));
    expect(select.questions.select).toEqual(expect.objectContaining({ text: true }));
  });

  it('does not create a new attempt for an unpublished exam', async () => {
    const prisma: any = {
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
      $executeRaw: jest.fn(),
      toeicExamSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 301,
          publicationStatus: QuizPublicationStatus.DRAFT,
          type: 'PRACTICE_BY_PART',
          durationSeconds: 600,
          groups: [],
        }),
      },
      toeicAttempt: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new ToeicService(prisma, {} as any);

    await expect(service.startAttempt(7, 301)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.toeicAttempt.create).not.toHaveBeenCalled();
  });
});
