import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PlanFeatureKey, QuizType, Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';
import { QuizContentAccessService } from './quiz-content-access.service';

describe('QuizContentAccessService (owner matrix 2026-10-28)', () => {
  const subscriptions = { effectivePlanCode: jest.fn() };
  let service: QuizContentAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.effectivePlanCode.mockResolvedValue('FREE');
    service = new QuizContentAccessService(
      subscriptions as unknown as SubscriptionService,
    );
  });

  const quiz = (
    type: QuizType,
    title: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 10,
    type,
    title,
    isPremiumContent: false,
    courseId: null,
    ...overrides,
  });

  it('keeps the content feature of each skill for callers that report it', () => {
    expect(service.featureForQuizType(QuizType.WRITING_EMAIL)).toBe(
      PlanFeatureKey.PREMIUM_WRITING_CONTENT,
    );
    expect(service.featureForQuizType(QuizType.LISTENING_PRACTICE)).toBe(
      PlanFeatureKey.PREMIUM_LISTENING,
    );
    expect(service.featureForQuizType(QuizType.TOEIC)).toBeNull();
  });

  it.each([
    [QuizType.LISTENING_PRACTICE, 'Listening A2 — Travel', 'FREE'],
    [QuizType.LISTENING_PRACTICE, 'Listening B1 — Work', 'PLUS'],
    [QuizType.BILINGUAL_READING, 'Reading C1 — Analysis', 'PLUS'],
    [QuizType.WRITING_EMAIL, 'Writing A2 — Messages', 'FREE'],
    [QuizType.WRITING_EMAIL, 'Writing B1 — Professional', 'PRO'],
    [QuizType.WRITING_PICTURE, 'Writing B2 — Pictures', 'PRO'],
  ])('%s "%s" requires %s', (type, title, required) => {
    expect(service.requiredPlan(quiz(type, title))).toBe(required);
  });

  it('exposes the CEFR level the plan was decided from', async () => {
    // Writing quiz 4 has no content level; its title tag is the authority.
    const access = await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Professional Email'),
      7,
    );
    expect(access).toMatchObject({ cefrLevel: 'B1', requiredPlan: 'PRO' });
    const course = await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Course', { courseId: 3 }),
      7,
    );
    expect(course.cefrLevel).toBeNull();
  });

  it('an untagged item never opens just because its tag is missing', () => {
    expect(
      service.requiredPlan(
        quiz(QuizType.WRITING_EMAIL, 'Untitled', { isPremiumContent: true }),
      ),
    ).toBe('PRO');
    expect(
      service.requiredPlan(
        quiz(QuizType.LISTENING_PRACTICE, 'Untitled', {
          isPremiumContent: true,
        }),
      ),
    ).toBe('PLUS');
  });

  it.each([
    ['FREE', 'Listening B1 — Work', true],
    ['PLUS', 'Listening B1 — Work', false],
    ['PLUS', 'Writing B1 — Professional', true],
    ['PRO', 'Writing B1 — Professional', false],
    ['PRO', 'Listening B1 — Work', false],
  ])('a %s learner on "%s": locked = %s', async (plan, title, locked) => {
    subscriptions.effectivePlanCode.mockResolvedValue(plan);
    const type = title.startsWith('Writing')
      ? QuizType.WRITING_EMAIL
      : QuizType.LISTENING_PRACTICE;
    const access = await service.resolve(quiz(type, title), 7);
    expect(access.isLocked).toBe(locked);
  });

  it('an unknown plan code ranks as FREE (fail closed)', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('LEGACY_GOLD');
    const access = await service.resolve(
      quiz(QuizType.LISTENING_PRACTICE, 'Listening B1 — Work'),
      7,
    );
    expect(access.isLocked).toBe(true);
  });

  it('a PLUS learner on B1 Writing is refused with PRO as the required plan', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('PLUS');
    await expect(
      service.assertAccess(
        quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Professional'),
        7,
      ),
    ).rejects.toMatchObject({
      response: { error: { requiredPlan: 'PRO' } },
    });
    await expect(
      service.assertAccess(
        quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Professional'),
        7,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a guest is asked to sign in for premium content', async () => {
    await expect(
      service.assertAccess(
        quiz(QuizType.BILINGUAL_READING, 'Reading B1 — Documents'),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('free content and admins never resolve a plan', async () => {
    await service.resolve(
      quiz(QuizType.LISTENING_PRACTICE, 'Listening A2 — Travel'),
      7,
    );
    await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Professional'),
      7,
      Role.ADMIN,
    );
    expect(subscriptions.effectivePlanCode).not.toHaveBeenCalled();
  });

  it('a list resolves the plan once', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('PLUS');
    const map = await service.resolveMany(
      [
        quiz(QuizType.LISTENING_PRACTICE, 'Listening B1 — Work', { id: 1 }),
        quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Professional', { id: 2 }),
        quiz(QuizType.WRITING_EMAIL, 'Writing A2 — Messages', { id: 3 }),
      ],
      7,
    );
    expect(subscriptions.effectivePlanCode).toHaveBeenCalledTimes(1);
    expect(map.get(1)?.isLocked).toBe(false);
    expect(map.get(2)).toMatchObject({ isLocked: true, requiredPlan: 'PRO' });
    expect(map.get(3)).toMatchObject({ isLocked: false, requiredPlan: 'FREE' });
  });
});
