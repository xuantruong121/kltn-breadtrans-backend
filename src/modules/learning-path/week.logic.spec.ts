import {
  estimateNextLevels,
  itemsToNextLevel,
  nextLevelLabel,
  skillWeights,
  weekStart,
  weeklyTargets,
} from './week.logic';

describe('weekStart', () => {
  it('is Monday 00:00 in Vietnam', () => {
    // Sunday 2026-11-01 10:00 Vietnam.
    expect(weekStart(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe(
      '2026-10-25T17:00:00.000Z',
    );
    // Sunday 23:30 UTC is already Monday 06:30 in Vietnam.
    expect(weekStart(new Date('2026-11-01T23:30:00Z')).toISOString()).toBe(
      '2026-11-01T17:00:00.000Z',
    );
  });
});

describe('weekly targets', () => {
  it('weights goal skills and the weakest skill', () => {
    expect(skillWeights(['LISTENING', 'SPEAKING'], 'SPEAKING')).toEqual({
      LISTENING: 2,
      READING: 1,
      SPEAKING: 3,
      WRITING: 1,
    });
  });

  it('turns weekly minutes into items, at least one per skill', () => {
    const even = skillWeights([], null);
    expect(weeklyTargets(20, even)).toEqual({
      LISTENING: 4,
      READING: 4,
      SPEAKING: 4,
      WRITING: 2,
    });
    expect(weeklyTargets(5, skillWeights(['LISTENING'], null)).WRITING).toBe(1);
  });
});

describe('estimateNextLevels', () => {
  const now = new Date('2026-11-01T03:00:00Z');
  const skills = [
    { skill: 'LISTENING' as const, unlockedLevel: 'BASIC' as const, done: 1 },
    { skill: 'WRITING' as const, unlockedLevel: 'BASIC' as const, done: 3 },
    { skill: 'READING' as const, unlockedLevel: 'ADVANCED' as const, done: 0 },
  ];

  it('counts what is left and skips the top level', () => {
    expect(itemsToNextLevel(skills[0])).toBe(2);
    expect(itemsToNextLevel(skills[1])).toBe(0);
    expect(itemsToNextLevel(skills[2])).toBe(0);
    const e = estimateNextLevels({
      skills,
      minutesPerDay: 15,
      targetDate: null,
      now,
    });
    expect(e.items).toBe(2);
    expect(e.days).toBe(2);
    expect(e.onTrack).toBeNull();
    expect(e.minutesNeeded).toBeNull();
  });

  it('moves the date with the daily minutes', () => {
    const at = (minutesPerDay: number) =>
      estimateNextLevels({ skills, minutesPerDay, targetDate: null, now }).days;
    expect(at(10)).toBe(2);
    expect(at(5)).toBe(4);
  });

  it('says whether a target date is met and what it would take', () => {
    const near = new Date('2026-11-02T03:00:00Z');
    const late = estimateNextLevels({
      skills,
      minutesPerDay: 5,
      targetDate: near,
      now,
    });
    expect(late.onTrack).toBe(false);
    expect(late.minutesNeeded).toBe(20);
    const far = estimateNextLevels({
      skills,
      minutesPerDay: 15,
      targetDate: new Date('2026-12-01T03:00:00Z'),
      now,
    });
    expect(far.onTrack).toBe(true);
  });

  it('gives no minutes for a target already past', () => {
    const past = estimateNextLevels({
      skills,
      minutesPerDay: 15,
      targetDate: new Date('2026-10-01T03:00:00Z'),
      now,
    });
    expect(past.onTrack).toBe(false);
    expect(past.minutesNeeded).toBeNull();
  });
});

describe('nextLevelLabel', () => {
  it('names the next level and stops at the top', () => {
    expect(nextLevelLabel('BASIC')).toBe('Trung cấp');
    expect(nextLevelLabel('ADVANCED')).toBeNull();
  });
});
