import { fakeDb } from '../../../test/helpers/learning-path-fake-db';
import { applyDiagnosticPlacement, applySelfLevel } from './placement.store';

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

describe('applySelfLevel', () => {
  it('sets every skill to the chosen level and opens levels up to it', async () => {
    const db = fakeDb();
    await applySelfLevel(db as any, 7, 'STARTER');
    for (const skill of ['LISTENING', 'READING', 'SPEAKING', 'WRITING'])
      expect(db.levels.get(`7:${skill}`)).toMatchObject({
        level: 'STARTER',
        unlockedLevel: 'STARTER',
        source: 'SELF',
      });
    expect(db.unlocks.size).toBe(4);
    expect(db.profiles.get(7)).toMatchObject({
      selfLevel: 'STARTER',
      placementSource: 'SELF',
    });
  });

  it('choosing lower keeps what was unlocked; diagnostic skills are kept', async () => {
    const db = fakeDb();
    await applyDiagnosticPlacement(db as any, 7, 100, {
      READING: { state: 'COMPLETE', score: 80 },
    });
    await applySelfLevel(db as any, 7, 'INTERMEDIATE');
    await applySelfLevel(db as any, 7, 'BASIC');
    expect(db.levels.get('7:READING')).toMatchObject({
      level: 'ADVANCED',
      source: 'DIAGNOSTIC',
    });
    expect(db.levels.get('7:LISTENING')).toMatchObject({
      level: 'BASIC',
      unlockedLevel: 'INTERMEDIATE',
    });
  });
});
