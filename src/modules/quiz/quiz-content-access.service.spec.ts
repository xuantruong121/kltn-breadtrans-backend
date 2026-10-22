import { UnauthorizedException } from '@nestjs/common';
import { PlanFeatureKey, QuizType, Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';
import { QuizContentAccessService } from './quiz-content-access.service';

describe('QuizContentAccessService', () => {
  const subscriptions = { hasFeature: jest.fn() };
  let service: QuizContentAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.hasFeature.mockResolvedValue(false);
    service = new QuizContentAccessService(
      subscriptions as unknown as SubscriptionService,
    );
  });

  const readingQuiz = (overrides: Record<string, unknown> = {}) => ({
    id: 10,
    type: QuizType.BILINGUAL_READING,
    isPremiumContent: true,
    courseId: null,
    ...overrides,
  });

  const writingQuiz = (overrides: Record<string, unknown> = {}) => ({
    id: 20,
    type: QuizType.WRITING_EMAIL,
    isPremiumContent: true,
    courseId: null,
    ...overrides,
  });

  it('maps Writing content to its own content feature', () => {
    expect(service.featureForQuizType(QuizType.WRITING_EMAIL)).toBe(
      PlanFeatureKey.PREMIUM_WRITING_CONTENT,
    );
    expect(service.featureForQuizType(QuizType.WRITING_PICTURE)).toBe(
      PlanFeatureKey.PREMIUM_WRITING_CONTENT,
    );
  });

  it('does not allow course-linked premium Writing without its entitlement', async () => {
    await expect(
      service.assertAccess(writingQuiz({ courseId: 9 }), 7),
    ).rejects.toMatchObject({
      response: {
        error: { featureKey: PlanFeatureKey.PREMIUM_WRITING_CONTENT },
      },
    });
  });

  it('does not let the existing vocabulary entitlement unlock Writing', async () => {
    subscriptions.hasFeature.mockImplementation(
      (_userId: number, key: PlanFeatureKey) =>
        key === PlanFeatureKey.PREMIUM_VOCAB,
    );
    await expect(service.assertAccess(writingQuiz(), 7)).rejects.toMatchObject({
      response: {
        error: {
          code: 'FEATURE_NOT_INCLUDED',
          featureKey: PlanFeatureKey.PREMIUM_WRITING_CONTENT,
        },
      },
    });
  });

  it('locks premium Reading without the feature', async () => {
    const rejection = service.assertAccess(readingQuiz(), 7);
    await expect(rejection).rejects.toMatchObject({
      response: {
        error: {
          code: 'FEATURE_NOT_INCLUDED',
          featureKey: PlanFeatureKey.PREMIUM_READING,
        },
      },
    });
  });

  it('allows premium Reading with the exact feature entitlement', async () => {
    subscriptions.hasFeature.mockResolvedValue(true);
    await expect(
      service.assertAccess(readingQuiz(), 7),
    ).resolves.toBeUndefined();
    expect(subscriptions.hasFeature).toHaveBeenCalledWith(
      7,
      PlanFeatureKey.PREMIUM_READING,
    );
  });

  it('does not allow an enrollment record to bypass premium Reading entitlement', async () => {
    await expect(
      service.assertAccess(readingQuiz({ courseId: 3 }), 7),
    ).rejects.toMatchObject({
      response: { error: { featureKey: PlanFeatureKey.PREMIUM_READING } },
    });
  });

  it('does not lock free content or require a subscription', async () => {
    await expect(
      service.assertAccess(readingQuiz({ isPremiumContent: false }), 7),
    ).resolves.toBeUndefined();
    expect(subscriptions.hasFeature).not.toHaveBeenCalled();
  });

  it('returns locked metadata for a guest without exposing content', async () => {
    await expect(service.assertAccess(readingQuiz())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.resolve(readingQuiz(), undefined),
    ).resolves.toMatchObject({
      isPremiumContent: true,
      isLocked: true,
      featureKey: PlanFeatureKey.PREMIUM_READING,
    });
  });

  it('lets Admin preview premium content without a PLUS subscription', async () => {
    await expect(
      service.assertAccess(readingQuiz(), 1, Role.ADMIN),
    ).resolves.toBeUndefined();
    expect(subscriptions.hasFeature).not.toHaveBeenCalled();
  });

  it('resolves list entitlement once per feature', async () => {
    const result = await service.resolveMany(
      [
        readingQuiz({ id: 1 }),
        readingQuiz({ id: 2 }),
        {
          id: 3,
          type: QuizType.LISTENING_PRACTICE,
          isPremiumContent: true,
          courseId: null,
        },
      ],
      7,
    );

    expect(subscriptions.hasFeature).toHaveBeenCalledTimes(2);
    expect(result.get(1)?.isLocked).toBe(true);
    expect(result.get(2)?.isLocked).toBe(true);
    expect(result.get(3)?.featureKey).toBe(PlanFeatureKey.PREMIUM_LISTENING);
  });
});
