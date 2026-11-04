import { QuizType } from '@prisma/client';

import {
  adviceLock,
  DiagnosticAdviceCatalogService,
} from './diagnostic-advice-catalog.service';
import { allAdviceResourceRefs } from './diagnostic-v2-advice';

const open = {
  isLocked: false,
  requiredPlan: 'FREE',
  isLevelLocked: false,
  practiceLevel: null,
};

describe('adviceLock', () => {
  it('opens what neither the plan nor the level holds back', () => {
    expect(adviceLock(open)).toEqual({ access: 'OPEN', requirement: null });
  });

  it('names an unopened level before a missing plan, as the item page does', () => {
    expect(
      adviceLock({
        isLocked: true,
        requiredPlan: 'PLUS',
        isLevelLocked: true,
        practiceLevel: 'INTERMEDIATE',
      }),
    ).toEqual({ access: 'LOCKED', requirement: 'Cần mở mức Trung cấp' });
  });

  it('names the plan when only the plan holds it back', () => {
    expect(
      adviceLock({ ...open, isLocked: true, requiredPlan: 'PRO' }),
    ).toEqual({ access: 'LOCKED', requirement: 'Cần gói PRO' });
  });
});

describe('DiagnosticAdviceCatalogService', () => {
  // Live harness 2026-11-03: a learner placed at Cơ bản in Reading was sent
  // to an Intermediate reading quiz marked OPEN, and the page refused it.
  it('marks a cited quiz LOCKED when the learner has not opened its level', async () => {
    const ref = allAdviceResourceRefs().find((r) => r.kind === 'READING_QUIZ')!;
    const prisma: any = {
      quiz: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: ref.id,
            title: 'Tài liệu công việc',
            type: QuizType.BILINGUAL_READING,
            isPremiumContent: false,
            bilingualContent: null,
          },
        ]),
      },
      speakingExercise: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const quizAccess: any = {
      resolveMany: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [
              ref.id,
              { ...open, isLevelLocked: true, practiceLevel: 'INTERMEDIATE' },
            ],
          ]),
        ),
    };
    const speakingAccess: any = {
      resolveMany: jest.fn().mockResolvedValue(new Map()),
    };
    const service = new DiagnosticAdviceCatalogService(
      prisma,
      undefined,
      quizAccess,
      speakingAccess,
    );

    const resolve = await service.resolverFor(7);

    expect(quizAccess.resolveMany).toHaveBeenCalledWith(expect.any(Array), 7);
    expect(resolve(ref)).toEqual(
      expect.objectContaining({
        route: `/reading/${ref.id}`,
        access: 'LOCKED',
        requirement: 'Cần mở mức Trung cấp',
      }),
    );
  });
});
