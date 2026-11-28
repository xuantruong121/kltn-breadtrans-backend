import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PlanFeatureKey, PracticeLevel, QuizType, Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';
import { QuizContentAccessService } from './quiz-content-access.service';

describe('QuizContentAccessService (owner matrix 2026-10-30)', () => {
  const subscriptions = { effectivePlanCode: jest.fn() };
  const quizRows = { findMany: jest.fn() };
  let service: QuizContentAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.effectivePlanCode.mockResolvedValue('FREE');
    quizRows.findMany.mockResolvedValue([]);
    service = new QuizContentAccessService(
      subscriptions as unknown as SubscriptionService,
      { quiz: quizRows } as never,
    );
  });

  const DICTATION = { mode: 'DICTATION' };
  const COMPREHENSION = { mode: 'COMPREHENSION' };
  const quiz = (
    type: QuizType,
    practiceLevel: PracticeLevel | null,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 10,
    type,
    practiceLevel,
    isPremiumContent: false,
    ...overrides,
  });
  const listening = (
    practiceLevel: PracticeLevel | null,
    mode: object,
    id = 10,
  ) =>
    quiz(QuizType.LISTENING_PRACTICE, practiceLevel, {
      id,
      bilingualContent: mode,
    });

  it('applies the matrix on routes that select no practiceLevel', async () => {
    quizRows.findMany.mockResolvedValue([
      { id: 10, practiceLevel: 'INTERMEDIATE', bilingualContent: null },
    ]);
    const bare = {
      id: 10,
      type: QuizType.WRITING_EMAIL,
      isPremiumContent: false,
    };
    await expect(service.assertAccess(bare, 7)).rejects.toThrow(
      ForbiddenException,
    );
    expect(quizRows.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, practiceLevel: true, bilingualContent: true },
      }),
    );
  });

  it('applies the dictation rule on routes that select neither field', async () => {
    quizRows.findMany.mockResolvedValue([
      {
        id: 11,
        practiceLevel: 'INTERMEDIATE',
        bilingualContent: { mode: 'DICTATION' },
      },
    ]);
    const access = await service.resolve(
      {
        id: 11,
        type: QuizType.LISTENING_PRACTICE,
        isPremiumContent: false,
      },
      7,
    );
    expect(access).toMatchObject({ isLocked: true, requiredPlan: 'PLUS' });
  });

  it('does not query for content outside the four skills', async () => {
    await service.resolve({
      id: 12,
      type: QuizType.TOEIC,
      isPremiumContent: false,
    });
    expect(quizRows.findMany).not.toHaveBeenCalled();
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
    ['BASIC', COMPREHENSION, 'FREE'],
    ['INTERMEDIATE', COMPREHENSION, 'FREE'],
    ['BASIC', DICTATION, 'FREE'],
    ['INTERMEDIATE', DICTATION, 'PLUS'],
    ['ADVANCED', DICTATION, 'PLUS'],
  ] as const)('Listening %s (%o) requires %s', (level, mode, required) => {
    expect(service.requiredPlan(listening(level, mode))).toBe(required);
  });

  it.each([
    [QuizType.BILINGUAL_READING, 'ADVANCED', 'FREE'],
    [QuizType.WRITING_EMAIL, 'BASIC', 'FREE'],
    [QuizType.WRITING_EMAIL, 'INTERMEDIATE', 'PLUS'],
    [QuizType.WRITING_PICTURE, 'INTERMEDIATE', 'PLUS'],
    [QuizType.WRITING_EMAIL, 'ADVANCED', 'PRO'],
  ] as const)('%s %s requires %s', (type, level, required) => {
    expect(service.requiredPlan(quiz(type, level))).toBe(required);
  });

  it('a Listening item checked without its mode counts as dictation', () => {
    expect(
      service.requiredPlan(quiz(QuizType.LISTENING_PRACTICE, 'INTERMEDIATE')),
    ).toBe('PLUS');
  });

  it('resolve loads the Listening mode the caller did not select', async () => {
    quizRows.findMany.mockResolvedValue([
      { id: 10, practiceLevel: 'INTERMEDIATE', bilingualContent: DICTATION },
    ]);
    const dictation = await service.resolve(
      quiz(QuizType.LISTENING_PRACTICE, 'INTERMEDIATE'),
      7,
    );
    expect(dictation).toMatchObject({ isLocked: true, requiredPlan: 'PLUS' });
    // The fields are kept 60 s (capacity run 2026-11-09); an edit is read
    // once that has passed.
    jest.useFakeTimers({ now: Date.now() + 61_000 });
    quizRows.findMany.mockResolvedValue([
      {
        id: 10,
        practiceLevel: 'INTERMEDIATE',
        bilingualContent: COMPREHENSION,
      },
    ]);
    const comprehension = await service.resolve(
      quiz(QuizType.LISTENING_PRACTICE, 'INTERMEDIATE'),
      7,
    );
    expect(comprehension).toMatchObject({
      isLocked: false,
      requiredPlan: 'FREE',
    });
    jest.useRealTimers();
  });

  it('exposes the practice level the plan was decided from', async () => {
    const access = await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'INTERMEDIATE'),
      7,
    );
    expect(access).toMatchObject({
      practiceLevel: 'INTERMEDIATE',
      requiredPlan: 'PLUS',
    });
  });

  it('an item without a level opens nothing its skill may charge for', () => {
    const untagged = (type: QuizType) =>
      service.requiredPlan(quiz(type, null, { isPremiumContent: true }));
    expect(untagged(QuizType.WRITING_EMAIL)).toBe('PRO');
    expect(untagged(QuizType.LISTENING_PRACTICE)).toBe('PLUS');
    expect(untagged(QuizType.BILINGUAL_READING)).toBe('FREE');
  });

  it.each([
    ['FREE', 'INTERMEDIATE', true],
    ['PLUS', 'INTERMEDIATE', false],
    ['PLUS', 'ADVANCED', true],
    ['PRO', 'ADVANCED', false],
  ] as const)(
    'a %s learner on %s Writing: locked = %s',
    async (plan, level, locked) => {
      subscriptions.effectivePlanCode.mockResolvedValue(plan);
      const access = await service.resolve(
        quiz(QuizType.WRITING_EMAIL, level),
        7,
      );
      expect(access.isLocked).toBe(locked);
    },
  );

  it.each([
    ['FREE', COMPREHENSION, false],
    ['FREE', DICTATION, true],
    ['PLUS', DICTATION, false],
  ])(
    'a %s learner on INTERMEDIATE Listening (%o): locked = %s',
    async (plan, mode, locked) => {
      subscriptions.effectivePlanCode.mockResolvedValue(plan);
      const access = await service.resolve(listening('INTERMEDIATE', mode), 7);
      expect(access.isLocked).toBe(locked);
    },
  );

  it('an unknown plan code ranks as FREE (fail closed)', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('LEGACY_GOLD');
    const access = await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'INTERMEDIATE'),
      7,
    );
    expect(access.isLocked).toBe(true);
  });

  it('a PLUS learner on ADVANCED Writing is refused with PRO as the required plan', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('PLUS');
    const advanced = quiz(QuizType.WRITING_EMAIL, 'ADVANCED');
    await expect(service.assertAccess(advanced, 7)).rejects.toMatchObject({
      response: { error: { requiredPlan: 'PRO' } },
    });
    await expect(service.assertAccess(advanced, 7)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a guest is asked to sign in for premium content', async () => {
    await expect(
      service.assertAccess(quiz(QuizType.WRITING_EMAIL, 'INTERMEDIATE')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('free content and admins never resolve a plan', async () => {
    await service.resolve(quiz(QuizType.BILINGUAL_READING, 'ADVANCED'), 7);
    await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'INTERMEDIATE'),
      7,
      Role.ADMIN,
    );
    expect(subscriptions.effectivePlanCode).not.toHaveBeenCalled();
  });

  it('a list resolves the plan once', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('PLUS');
    const map = await service.resolveMany(
      [
        listening('INTERMEDIATE', DICTATION, 1),
        quiz(QuizType.WRITING_EMAIL, 'ADVANCED', { id: 2 }),
        quiz(QuizType.WRITING_EMAIL, 'BASIC', { id: 3 }),
      ],
      7,
    );
    expect(subscriptions.effectivePlanCode).toHaveBeenCalledTimes(1);
    expect(map.get(1)?.isLocked).toBe(false);
    expect(map.get(2)).toMatchObject({ isLocked: true, requiredPlan: 'PRO' });
    expect(map.get(3)).toMatchObject({ isLocked: false, requiredPlan: 'FREE' });
  });
});
