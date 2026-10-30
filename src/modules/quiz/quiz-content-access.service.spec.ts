import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PlanFeatureKey, QuizType, Role } from '@prisma/client';
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
  const listening = (title: string, mode: object, id = 10) =>
    quiz(QuizType.LISTENING_PRACTICE, title, { id, bilingualContent: mode });

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
    ['Listening A2 — Travel', COMPREHENSION, 'FREE'],
    ['Listening B2 — Inference', COMPREHENSION, 'FREE'],
    ['Nghe chép A2 — Du lịch', DICTATION, 'FREE'],
    ['Nghe chép B1 — Công việc', DICTATION, 'PLUS'],
    ['Nghe chép C1 — Thời sự', DICTATION, 'PLUS'],
  ])('Listening "%s" (%o) requires %s', (title, mode, required) => {
    expect(service.requiredPlan(listening(title, mode))).toBe(required);
  });

  it.each([
    [QuizType.BILINGUAL_READING, 'Reading C1 — Analysis', 'FREE'],
    [QuizType.WRITING_EMAIL, 'Writing A2 — Messages', 'FREE'],
    [QuizType.WRITING_EMAIL, 'Writing B1 — Professional', 'PLUS'],
    [QuizType.WRITING_PICTURE, 'Writing B2 — Pictures', 'PLUS'],
    [QuizType.WRITING_EMAIL, 'Writing C1 — Reports', 'PRO'],
    [QuizType.WRITING_EMAIL, 'Writing B2–C1 — Essays', 'PRO'],
  ])('%s "%s" requires %s', (type, title, required) => {
    expect(service.requiredPlan(quiz(type, title))).toBe(required);
  });

  it('a Listening item checked without its mode counts as dictation', () => {
    expect(
      service.requiredPlan(
        quiz(QuizType.LISTENING_PRACTICE, 'Listening B1 — Work'),
      ),
    ).toBe('PLUS');
  });

  it('resolve loads the Listening mode the caller did not select', async () => {
    quizRows.findMany.mockResolvedValue([
      { id: 10, bilingualContent: DICTATION },
    ]);
    const dictation = await service.resolve(
      quiz(QuizType.LISTENING_PRACTICE, 'Nghe chép B1 — Công việc'),
      7,
    );
    expect(dictation).toMatchObject({ isLocked: true, requiredPlan: 'PLUS' });
    quizRows.findMany.mockResolvedValue([
      { id: 10, bilingualContent: COMPREHENSION },
    ]);
    const comprehension = await service.resolve(
      quiz(QuizType.LISTENING_PRACTICE, 'Listening B1 — Work'),
      7,
    );
    expect(comprehension).toMatchObject({
      isLocked: false,
      requiredPlan: 'FREE',
    });
  });

  it('exposes the CEFR level the plan was decided from', async () => {
    const access = await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Professional Email'),
      7,
    );
    expect(access).toMatchObject({ cefrLevel: 'B1', requiredPlan: 'PLUS' });
    const course = await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Course', { courseId: 3 }),
      7,
    );
    expect(course.cefrLevel).toBeNull();
  });

  it('an untagged premium item opens nothing its skill may charge for', () => {
    const untagged = (type: QuizType) =>
      service.requiredPlan(quiz(type, 'Untitled', { isPremiumContent: true }));
    expect(untagged(QuizType.WRITING_EMAIL)).toBe('PRO');
    expect(untagged(QuizType.LISTENING_PRACTICE)).toBe('PLUS');
    expect(untagged(QuizType.BILINGUAL_READING)).toBe('FREE');
  });

  it.each([
    ['FREE', 'Writing B1 — Professional', true],
    ['PLUS', 'Writing B1 — Professional', false],
    ['PLUS', 'Writing C1 — Reports', true],
    ['PRO', 'Writing C1 — Reports', false],
  ])('a %s learner on "%s": locked = %s', async (plan, title, locked) => {
    subscriptions.effectivePlanCode.mockResolvedValue(plan);
    const access = await service.resolve(
      quiz(QuizType.WRITING_EMAIL, title),
      7,
    );
    expect(access.isLocked).toBe(locked);
  });

  it.each([
    ['FREE', COMPREHENSION, false],
    ['FREE', DICTATION, true],
    ['PLUS', DICTATION, false],
  ])(
    'a %s learner on B1 Listening (%o): locked = %s',
    async (plan, mode, locked) => {
      subscriptions.effectivePlanCode.mockResolvedValue(plan);
      const access = await service.resolve(
        listening('Nghe B1 — Work', mode),
        7,
      );
      expect(access.isLocked).toBe(locked);
    },
  );

  it('an unknown plan code ranks as FREE (fail closed)', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('LEGACY_GOLD');
    const access = await service.resolve(
      quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Professional'),
      7,
    );
    expect(access.isLocked).toBe(true);
  });

  it('a PLUS learner on C1 Writing is refused with PRO as the required plan', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('PLUS');
    const c1 = quiz(QuizType.WRITING_EMAIL, 'Writing C1 — Reports');
    await expect(service.assertAccess(c1, 7)).rejects.toMatchObject({
      response: { error: { requiredPlan: 'PRO' } },
    });
    await expect(service.assertAccess(c1, 7)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a guest is asked to sign in for premium content', async () => {
    await expect(
      service.assertAccess(
        quiz(QuizType.WRITING_EMAIL, 'Writing B1 — Professional'),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('free content and admins never resolve a plan', async () => {
    await service.resolve(
      quiz(QuizType.BILINGUAL_READING, 'Reading C1 — Analysis'),
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
        listening('Nghe chép B1 — Work', DICTATION, 1),
        quiz(QuizType.WRITING_EMAIL, 'Writing C1 — Reports', { id: 2 }),
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
