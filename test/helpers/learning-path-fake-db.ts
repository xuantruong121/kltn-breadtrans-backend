// Test helper (not a spec): in-memory stand-in for the learning-path tables.
/** Minimal in-memory stand-in for the three tables the store touches. */
export function fakeDb() {
  const profiles = new Map<number, any>();
  const levels = new Map<string, any>();
  const unlocks = new Map<string, any>();
  const progressEvents: Array<{ userId: number; skill: string }> = [];
  const key = (w: any) => `${w.userId_skill.userId}:${w.userId_skill.skill}`;
  return {
    profiles,
    levels,
    unlocks,
    /** Graded attempts by skill: only applySelfLevel reads this. */
    progressEvents,
    learnerProgressEvent: {
      count: ({ where }: any) =>
        Promise.resolve(
          progressEvents.filter(
            (e) => e.userId === where.userId && e.skill === where.skill,
          ).length,
        ),
    },
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
