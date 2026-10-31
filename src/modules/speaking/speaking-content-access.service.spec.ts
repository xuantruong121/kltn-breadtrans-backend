import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SubscriptionService } from '../subscription/subscription.service';
import { SpeakingContentAccessService } from './speaking-content-access.service';

describe('SpeakingContentAccessService (owner matrix 2026-10-30)', () => {
  const subscriptions = { effectivePlanCode: jest.fn() };
  let service: SpeakingContentAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.effectivePlanCode.mockResolvedValue('FREE');
    service = new SpeakingContentAccessService(
      subscriptions as unknown as SubscriptionService,
    );
  });

  const exercise = (level: string | null, overrides = {}) => ({
    id: 5,
    isPremiumContent: false,
    title: 'Task',
    practiceSet: level ? { scope: 'SKILL_PRACTICE', level } : null,
    ...overrides,
  });

  it.each([
    ['A1-A2', 'FREE'],
    ['A2', 'FREE'],
    ['B1', 'PLUS'],
    ['B1-B2', 'PLUS'],
    ['B2-C1', 'PRO'],
    ['C1', 'PRO'],
  ])('a %s set requires %s', (level, required) => {
    expect(service.requiredPlan(exercise(level))).toBe(required);
  });

  it.each([
    ['FREE', 'B1', true],
    ['PLUS', 'B1', false],
    ['PLUS', 'C1', true],
    ['PRO', 'C1', false],
  ])(
    'a %s learner on %s Speaking: locked = %s',
    async (plan, level, locked) => {
      subscriptions.effectivePlanCode.mockResolvedValue(plan);
      expect((await service.resolve(exercise(level), 7)).isLocked).toBe(locked);
    },
  );

  it('exposes the practice set level, never one for an exam task', async () => {
    expect((await service.resolve(exercise('B1-B2'), 7)).cefrLevel).toBe(
      'B1-B2',
    );
    expect(
      (
        await service.resolve(
          exercise(null, {
            practiceSet: { scope: 'EXAM_INTERNAL', level: 'A2' },
          }),
          7,
        )
      ).cefrLevel,
    ).toBeNull();
  });

  it('exam tasks keep their stored flag, which then needs PRO', () => {
    expect(
      service.requiredPlan(
        exercise(null, {
          isPremiumContent: true,
          practiceSet: { scope: 'EXAM_INTERNAL', level: 'A2' },
        }),
      ),
    ).toBe('PRO');
  });

  it('refuses a PLUS learner with PRO as the required plan, and asks guests to sign in', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('PLUS');
    await expect(service.assertAccess(exercise('C1'), 7)).rejects.toMatchObject(
      { response: { error: { requiredPlan: 'PRO' } } },
    );
    await expect(
      service.assertAccess(exercise('C1'), 7),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertAccess(exercise('C1'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('a list resolves the plan once; admins are never locked', async () => {
    subscriptions.effectivePlanCode.mockResolvedValue('PLUS');
    const map = await service.resolveMany(
      [exercise('A2', { id: 1 }), exercise('C1', { id: 2 })],
      7,
    );
    expect(subscriptions.effectivePlanCode).toHaveBeenCalledTimes(1);
    expect(map.get(1)?.isLocked).toBe(false);
    expect(map.get(2)).toMatchObject({ isLocked: true, requiredPlan: 'PRO' });
    expect(
      (await service.resolve(exercise('C1'), 7, Role.ADMIN)).isLocked,
    ).toBe(false);
  });
});
