import { BadRequestException, ConflictException } from '@nestjs/common';

import { LearningPathService } from './learning-path.service';
import { fakeDb } from '../../../test/helpers/learning-path-fake-db';

function service() {
  const db: any = fakeDb();
  db.learnerSkillLevel.findMany = ({ where }: any) =>
    Promise.resolve(
      [...db.levels.values()].filter((r: any) => r.userId === where.userId),
    );
  db.$transaction = (fn: (tx: unknown) => unknown) => fn(db);
  // The skill-level lock (audit C6).
  db.$executeRaw = () => Promise.resolve(0);
  db.diagnosticAttempt = { findFirst: () => Promise.resolve(null) };
  db.learnerProgressEvent.findMany = () => Promise.resolve([]);
  return {
    db,
    svc: new LearningPathService(
      db,
      {
        effectivePlanCode: () => Promise.resolve(null),
      } as never,
      {
        unlockedLevels: () =>
          Promise.resolve({
            LISTENING: 'BASIC',
            READING: 'BASIC',
            SPEAKING: 'BASIC',
            WRITING: 'BASIC',
          }),
      } as never,
    ),
  };
}

describe('LearningPathService profile', () => {
  it('returns defaults before onboarding', async () => {
    const { svc } = service();
    const p = await svc.getProfile(7);
    expect(p).toMatchObject({
      track: 'GENERAL',
      trackName: 'Chung',
      goal: 'GENERAL',
      minutesPerDay: 15,
      placementSource: 'NONE',
      onboarded: false,
    });
    expect(p.skills.map((s) => s.level)).toEqual([null, null, null, null]);
    expect(p.skills[0]).toMatchObject({
      unlockedLevel: 'BASIC',
      nextLevel: 'INTERMEDIATE',
      progress: { done: 0, needed: 3, neededAverage: 70, average: null },
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
      trackName: 'Công nghệ thông tin',
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

  it('refuses a track that is unknown or switched off', async () => {
    const { db, svc } = service();
    db.tracks.set('HOSPITALITY_TOURISM', {
      code: 'HOSPITALITY_TOURISM',
      name: 'Nhà hàng – Khách sạn – Du lịch',
      isActive: false,
    });
    await expect(
      svc.updateProfile(7, { track: 'HOSPITALITY_TOURISM' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.updateProfile(7, { track: 'NOT_A_TRACK' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.profiles.has(7)).toBe(false);
  });

  it('keeps a track the learner chose before an admin switched it off', async () => {
    const { db, svc } = service();
    db.tracks.set('HOSPITALITY_TOURISM', {
      code: 'HOSPITALITY_TOURISM',
      name: 'Nhà hàng – Khách sạn – Du lịch',
      isActive: false,
    });
    db.profiles.set(7, { userId: 7, track: 'HOSPITALITY_TOURISM' });
    const p = await svc.updateProfile(7, {
      track: 'HOSPITALITY_TOURISM',
      minutesPerDay: 30,
    });
    expect(p).toMatchObject({
      track: 'HOSPITALITY_TOURISM',
      trackName: 'Nhà hàng – Khách sạn – Du lịch',
      minutesPerDay: 30,
    });
  });

  it('keeps the first onboarding time', async () => {
    const { db, svc } = service();
    await svc.updateProfile(7, { onboarded: true });
    const first = db.profiles.get(7).onboardedAt;
    await svc.updateProfile(7, { onboarded: true, minutesPerDay: 30 });
    expect(db.profiles.get(7).onboardedAt).toBe(first);
  });
});
