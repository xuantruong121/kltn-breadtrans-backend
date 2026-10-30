import { QuizType, TopicCategory } from '@prisma/client';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';

describe('Writing submissions list (privacy)', () => {
  it('requires a signed-in learner (no optional guard)', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      WritingController.prototype.getCommunitySubmissions,
    );
    expect(guards).toEqual([JwtAuthGuard]);
  });

  it("returns only the caller's own submissions, without any learner name", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 5,
        score: 8,
        results: [{ answer: 'My text.' }],
        aiFeedback: '{}',
        submittedAt: new Date(),
      },
    ]);
    const prisma = {
      quiz: {
        findUnique: jest.fn().mockResolvedValue({
          id: 3,
          type: QuizType.WRITING_PICTURE,
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
          courseId: null,
          practiceTopic: { category: TopicCategory.WRITING_PART1 },
        }),
      },
      submission: { findMany },
    };
    const service = new WritingService(prisma as any, {} as any);
    const rows = await service.getCommunitySubmissions(3, 7);
    expect(findMany.mock.calls[0][0].where).toEqual({ quizId: 3, userId: 7 });
    expect(findMany.mock.calls[0][0].include).toEqual({ results: true });
    expect(rows[0]).not.toHaveProperty('user');
  });
});
