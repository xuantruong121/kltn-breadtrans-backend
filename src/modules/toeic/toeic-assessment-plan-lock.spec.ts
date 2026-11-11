import { ForbiddenException } from '@nestjs/common';

import {
  toeicExamLock,
  toeicFamilyNeedsPro,
} from '../subscription/plan-limits';
import { ToeicAssessmentService } from './toeic-assessment.service';

describe('toeicExamLock', () => {
  it('asks for Pro on Speaking & Writing and four-skill exams only', () => {
    expect(toeicFamilyNeedsPro('TOEIC_LR')).toBe(false);
    expect(toeicFamilyNeedsPro('TOEIC_SW')).toBe(true);
    expect(toeicFamilyNeedsPro('TOEIC_4_SKILLS')).toBe(true);
  });

  it('never locks a Listening & Reading exam', () => {
    for (const plan of ['FREE', 'PLUS', 'PRO', null])
      expect(toeicExamLock('TOEIC_LR', plan)).toEqual({
        requiredPlan: 'FREE',
        isLocked: false,
      });
  });

  it('locks a productive exam for Free and Plus, and opens it for Pro', () => {
    for (const family of ['TOEIC_SW', 'TOEIC_4_SKILLS']) {
      expect(toeicExamLock(family, 'FREE')).toEqual({
        requiredPlan: 'PRO',
        isLocked: true,
      });
      expect(toeicExamLock(family, 'PLUS').isLocked).toBe(true);
      expect(toeicExamLock(family, undefined).isLocked).toBe(true);
      expect(toeicExamLock(family, 'PRO')).toEqual({
        requiredPlan: 'PRO',
        isLocked: false,
      });
    }
  });
});

describe('ToeicAssessmentService plan lock', () => {
  const PASSED_THE_GATE = new Error('reached the transaction');

  function setup(plan: 'FREE' | 'PLUS' | 'PRO' | null, productFamily: string) {
    const db = {
      $transaction: jest.fn().mockRejectedValue(PASSED_THE_GATE),
      toeicAssessment: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 8, title: 'Đề', productFamily, components: [] },
          ]),
      },
      toeicAssessmentAttempt: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const subscriptions = plan
      ? { planCodeFor: jest.fn().mockResolvedValue(plan) }
      : undefined;
    const service = new ToeicAssessmentService(
      db as any,
      {} as any,
      {} as any,
      subscriptions as any,
    );
    jest
      .spyOn(service as any, 'getPublishedAssessment')
      .mockResolvedValue({ id: 8, productFamily, components: [] });
    jest.spyOn(service as any, 'projectComponents').mockResolvedValue([]);
    return { service, db, subscriptions };
  }

  it.each([
    ['FREE', 'TOEIC_SW'],
    ['PLUS', 'TOEIC_SW'],
    ['FREE', 'TOEIC_4_SKILLS'],
    ['PLUS', 'TOEIC_4_SKILLS'],
  ] as const)(
    'refuses a new %s session of a %s exam before anything is written',
    async (plan, family) => {
      const { service, db } = setup(plan, family);
      const attempt = service.startAttempt(8, 7);
      await expect(attempt).rejects.toThrow(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({
        response: {
          requiredPlan: 'PRO',
          message:
            'Đề TOEIC Speaking & Writing và đề 4 kỹ năng là quyền lợi của gói Pro.',
        },
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['PRO', 'TOEIC_SW'],
    ['PRO', 'TOEIC_4_SKILLS'],
    ['FREE', 'TOEIC_LR'],
    ['PLUS', 'TOEIC_LR'],
  ] as const)('lets a %s learner start a %s exam', async (plan, family) => {
    const { service } = setup(plan, family);
    await expect(service.startAttempt(8, 7)).rejects.toBe(PASSED_THE_GATE);
  });

  it('treats a learner whose plan cannot be read as Free', async () => {
    const { service } = setup(null, 'TOEIC_SW');
    await expect(service.startAttempt(8, 7)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('does not lock an admin, and does not look up a plan for one', async () => {
    const { service, subscriptions } = setup('FREE', 'TOEIC_4_SKILLS');
    await expect(service.startAttempt(8, 7, undefined, 'ADMIN')).rejects.toBe(
      PASSED_THE_GATE,
    );
    expect(subscriptions?.planCodeFor).not.toHaveBeenCalled();
  });

  it('tells the exam list which exams are locked for this learner', async () => {
    const plus = await setup('PLUS', 'TOEIC_SW').service.listLearner(7);
    expect(plus[0]).toMatchObject({ requiredPlan: 'PRO', isLocked: true });
    const pro = await setup('PRO', 'TOEIC_SW').service.listLearner(7);
    expect(pro[0]).toMatchObject({ requiredPlan: 'PRO', isLocked: false });
    const lr = await setup('FREE', 'TOEIC_LR').service.listLearner(7);
    expect(lr[0]).toMatchObject({ requiredPlan: 'FREE', isLocked: false });
  });
});
