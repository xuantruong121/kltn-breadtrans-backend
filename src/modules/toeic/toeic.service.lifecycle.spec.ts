import { NotFoundException } from '@nestjs/common';
import { QuizPublicationStatus } from '@prisma/client';
import { ToeicService } from './toeic.service';

describe('ToeicService learner publication boundary', () => {
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
