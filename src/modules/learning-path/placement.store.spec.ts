import { applyDiagnosticPlacement } from './placement.store';

/** Minimal in-memory stand-in for the three tables the store touches. */
function fakeDb() {
  const profiles = new Map<number, any>();
  const levels = new Map<string, any>();
  const unlocks = new Map<string, any>();
  const key = (w: any) => `${w.userId_skill.userId}:${w.userId_skill.skill}`;
  return {
    profiles,
    levels,
    unlocks,
    learnerProfile: {
      findUnique: ({ where }: any) =>
        Promise.resolve(profiles.get(where.userId) ?? null),
      upsert: ({ where, create, update }: any) => {
        const row = profiles.has(where.userId)
          ? { ...profiles.get(where.userId), ...update }
          : { ...create };
        profiles.set(where.userId, row);
        return Promise.resolve(row);
      },
    },
    learnerSkillLevel: {
      findUnique: ({ where }: any) =>
        Promise.resolve(levels.get(key(where)) ?? null),
      upsert: ({ where, create, update }: any) => {
        const k = key(where);
        const row = levels.has(k)
          ? { ...levels.get(k), ...update }
          : { ...create };
        levels.set(k, row);
        return Promise.resolve(row);
      },
    },
    levelUnlock: {
      createMany: ({ data }: any) => {
        for (const d of data) {
          const k = `${d.userId}:${d.skill}:${d.level}`;
          if (!unlocks.has(k)) unlocks.set(k, d);
        }
        return Promise.resolve({ count: data.length });
      },
    },
  };
}

const done = (score: number) => ({ state: 'COMPLETE', score });
const pending = { state: 'PENDING_GRADING', score: null };

describe('applyDiagnosticPlacement', () => {
  it('places objective skills at submission and productive skills once graded', async () => {
    const db = fakeDb();
    await applyDiagnosticPlacement(db as any, 7, 100, {
      LISTENING: done(80),
      READING: done(60),
      SPEAKING: pending,
      WRITING: pending,
    });
    expect(db.levels.get('7:LISTENING')).toMatchObject({
      level: 'ADVANCED',
      unlockedLevel: 'ADVANCED',
      source: 'DIAGNOSTIC',
    });
    expect(db.levels.has('7:SPEAKING')).toBe(false);
    expect(db.unlocks.size).toBe(4 + 3);
    expect(db.profiles.get(7)).toMatchObject({
      placementLevel: 'INTERMEDIATE',
      placementSource: 'DIAGNOSTIC',
      placementAttemptId: 100,
    });

    await applyDiagnosticPlacement(db as any, 7, 100, {
      LISTENING: done(80),
      READING: done(60),
      SPEAKING: done(20),
      WRITING: done(40),
    });
    expect(db.levels.get('7:SPEAKING').level).toBe('STARTER');
    expect(db.levels.get('7:WRITING').level).toBe('BASIC');
    expect(db.profiles.get(7).placementLevel).toBe('BASIC');
  });

  it('re-reading the attempt never lowers a level reached later', async () => {
    const db = fakeDb();
    const outcome = { READING: done(40) };
    await applyDiagnosticPlacement(db as any, 7, 100, outcome);
    // A gate test later opened INTERMEDIATE.
    db.levels.set('7:READING', {
      ...db.levels.get('7:READING'),
      level: 'INTERMEDIATE',
      unlockedLevel: 'INTERMEDIATE',
    });
    await applyDiagnosticPlacement(db as any, 7, 100, outcome);
    expect(db.levels.get('7:READING')).toMatchObject({
      level: 'INTERMEDIATE',
      unlockedLevel: 'INTERMEDIATE',
    });
  });

  it('a new attempt replaces the level but keeps a higher unlock', async () => {
    const db = fakeDb();
    db.levels.set('7:READING', {
      userId: 7,
      skill: 'READING',
      level: 'ADVANCED',
      unlockedLevel: 'ADVANCED',
      source: 'SELF',
    });
    await applyDiagnosticPlacement(db as any, 7, 100, { READING: done(40) });
    expect(db.levels.get('7:READING')).toMatchObject({
      level: 'BASIC',
      unlockedLevel: 'ADVANCED',
      source: 'DIAGNOSTIC',
    });
  });

  it('an older attempt does not override a newer placement', async () => {
    const db = fakeDb();
    await applyDiagnosticPlacement(db as any, 7, 200, { READING: done(90) });
    expect(
      await applyDiagnosticPlacement(db as any, 7, 100, { READING: done(10) }),
    ).toBeNull();
    expect(db.levels.get('7:READING').level).toBe('ADVANCED');
  });

  it('writes nothing without a completed skill', async () => {
    const db = fakeDb();
    expect(
      await applyDiagnosticPlacement(db as any, 7, 100, { READING: pending }),
    ).toBeNull();
    expect(db.profiles.size + db.levels.size + db.unlocks.size).toBe(0);
  });
});
