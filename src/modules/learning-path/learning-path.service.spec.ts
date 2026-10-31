import { ConflictException } from '@nestjs/common';

import { LearningPathService } from './learning-path.service';
import { fakeDb } from '../../../test/helpers/learning-path-fake-db';

function service() {
  const db: any = fakeDb();
  db.learnerSkillLevel.findMany = ({ where }: any) =>
    Promise.resolve(
      [...db.levels.values()].filter((r: any) => r.userId === where.userId),
    );
  db.$transaction = (fn: (tx: unknown) => unknown) => fn(db);
  db.diagnosticAttempt = { findFirst: () => Promise.resolve(null) };
  db.learnerProgressEvent.findMany = () => Promise.resolve([]);
  return {
    db,
    svc: new LearningPathService(db, {
      effectivePlanCode: () => Promise.resolve(null),
    } as never),
  };
}

describe('LearningPathService profile', () => {
  it('returns defaults before onboarding', async () => {
    const { svc } = service();
    const p = await svc.getProfile(7);
    expect(p).toMatchObject({
      track: 'GENERAL',
      goal: 'GENERAL',
      minutesPerDay: 15,
      placementSource: 'NONE',
      onboarded: false,
    });
    expect(p.skills.map((s) => s.level)).toEqual([null, null, null, null]);
    expect(p.skills[0]).toMatchObject({
      unlockedLevel: 'BASIC',
      nextLevel: 'INTERMEDIATE',
      progress: { done: 0, needed: 3, average: null },
    });
  });

  it('saves onboarding answers and a self-chosen level', async () => {
    const { svc } = service();
    const p = await svc.updateProfile(7, {
      track: 'IT_SOFTWARE',
      goal: 'WORK_COMMUNICATION',
      minutesPerDay: 20,
      selfLevel: 'STARTER',
      onboarded: true,
    });
    expect(p).toMatchObject({
      track: 'IT_SOFTWARE',
      minutesPerDay: 20,
      selfLevel: 'STARTER',
      placementSource: 'SELF',
      onboarded: true,
    });
    expect(p.skills.every((s) => s.level === 'STARTER')).toBe(true);
  });

  it('refuses a self level once the diagnostic placed the learner', async () => {
    const { db, svc } = service();
    db.profiles.set(7, { userId: 7, placementSource: 'DIAGNOSTIC' });
    await expect(
      svc.updateProfile(7, { selfLevel: 'ADVANCED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps the first onboarding time', async () => {
    const { db, svc } = service();
    await svc.updateProfile(7, { onboarded: true });
    const first = db.profiles.get(7).onboardedAt;
    await svc.updateProfile(7, { onboarded: true, minutesPerDay: 30 });
    expect(db.profiles.get(7).onboardedAt).toBe(first);
  });
});
