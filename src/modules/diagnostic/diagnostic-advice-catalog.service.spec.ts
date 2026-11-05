import { QuizType } from '@prisma/client';

import {
  adviceLock,
  DiagnosticAdviceCatalogService,
  recommendationResource,
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
    expect(adviceLock(open)).toEqual({
      access: 'OPEN',
      requirement: null,
      lockedBy: null,
    });
  });

  it('names an unopened level before a missing plan, as the item page does', () => {
    expect(
      adviceLock({
        isLocked: true,
        requiredPlan: 'PLUS',
        isLevelLocked: true,
        practiceLevel: 'INTERMEDIATE',
      }),
    ).toEqual({
      access: 'LOCKED',
      requirement: 'Cần mở mức Trung cấp',
      lockedBy: 'LEVEL',
    });
  });

  it('names the plan when only the plan holds it back', () => {
    expect(
      adviceLock({ ...open, isLocked: true, requiredPlan: 'PRO' }),
    ).toEqual({
      access: 'LOCKED',
      requirement: 'Cần gói PRO',
      lockedBy: 'PLAN',
    });
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

describe('recommendationResource', () => {
  it('turns a speaking set into an exercise link with its set key', () => {
    expect(
      recommendationResource({
        contentType: 'SPEAKING_SET',
        contentId: 61,
        skill: 'SPEAKING',
        title: 'Read aloud A2',
        route: '/speaking/61?set=practice-read-aloud-a1-a2',
      }),
    ).toEqual(
      expect.objectContaining({
        kind: 'SPEAKING_EXERCISE',
        id: 61,
        access: 'OPEN',
        setKey: 'practice-read-aloud-a1-a2',
      }),
    );
  });

  it('turns a quiz into the quiz kind of its skill', () => {
    expect(
      recommendationResource({
        contentType: 'QUIZ',
        contentId: 17,
        skill: 'WRITING',
        title: 'W',
        route: '/writing/17',
      }),
    ).toEqual(
      expect.objectContaining({
        kind: 'WRITING_QUIZ',
        id: 17,
        route: '/writing/17',
      }),
    );
    expect(
      recommendationResource({
        contentType: 'CONTENT_TOPIC',
        contentId: 1,
        skill: 'READING',
        title: 'x',
        route: '/x',
      }),
    ).toBeNull();
  });
});
