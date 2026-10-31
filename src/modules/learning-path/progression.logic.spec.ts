import {
  effectiveUnlockedLevel,
  isLevelLocked,
  levelProgress,
  nextLevel,
  percentOfAttempt,
  progressUnlockTarget,
} from './progression.logic';

describe('level progress', () => {
  const event = (contentId: number, scorePercent: number) => ({
    contentId,
    scorePercent,
  });

  it('steps through the levels and stops at the top', () => {
    expect(nextLevel('STARTER')).toBe('BASIC');
    expect(nextLevel('ADVANCED')).toBeNull();
    expect(isLevelLocked('INTERMEDIATE', 'BASIC')).toBe(true);
    expect(isLevelLocked('BASIC', 'INTERMEDIATE')).toBe(false);
    expect(isLevelLocked('BASIC', 'BASIC')).toBe(false);
  });

  it('counts distinct items and averages the best of each', () => {
    expect(levelProgress([event(1, 40), event(1, 80), event(2, 60)])).toEqual({
      done: 2,
      needed: 3,
      average: 70,
    });
    expect(levelProgress([])).toEqual({ done: 0, needed: 3, average: null });
  });

  it('averages only the top three items', () => {
    expect(
      levelProgress([event(1, 90), event(2, 80), event(3, 70), event(4, 0)]),
    ).toMatchObject({ done: 4, average: 80 });
  });

  it('opens the next level at three items averaging 70', () => {
    const base = { unlockedLevel: 'BASIC' as const, ability: 0 };
    expect(
      progressUnlockTarget({
        ...base,
        events: [event(1, 70), event(2, 70), event(3, 70)],
      }),
    ).toEqual({ level: 'INTERMEDIATE', reason: 'ITEMS' });
    expect(
      progressUnlockTarget({
        ...base,
        events: [event(1, 70), event(2, 70), event(3, 69)],
      }),
    ).toBeNull();
    expect(
      progressUnlockTarget({ ...base, events: [event(1, 100), event(2, 100)] }),
    ).toBeNull();
  });

  it('opens the next level when ability reaches its seed', () => {
    expect(
      progressUnlockTarget({
        unlockedLevel: 'BASIC',
        ability: 1.3,
        events: [],
      }),
    ).toEqual({ level: 'INTERMEDIATE', reason: 'ABILITY' });
  });

  it('has nothing to open past the top level', () => {
    expect(
      progressUnlockTarget({
        unlockedLevel: 'ADVANCED',
        ability: 9,
        events: [event(1, 100), event(2, 100), event(3, 100)],
      }),
    ).toBeNull();
  });

  it('passes over levels with no published content', () => {
    expect(
      effectiveUnlockedLevel('STARTER', new Set(['BASIC', 'INTERMEDIATE'])),
    ).toBe('BASIC');
    expect(effectiveUnlockedLevel('STARTER', new Set(['STARTER']))).toBe(
      'STARTER',
    );
    expect(effectiveUnlockedLevel('BASIC', new Set())).toBe('ADVANCED');
  });
});

describe('percentOfAttempt', () => {
  it('reads Listening and Reading as correct answers over questions', () => {
    expect(percentOfAttempt({ skill: 'READING', score: 3, questions: 5 })).toBe(
      60,
    );
    expect(
      percentOfAttempt({ skill: 'LISTENING', score: 2, questions: 20 }),
    ).toBe(10);
  });

  it('reads Speaking on its 0-10 scale', () => {
    expect(percentOfAttempt({ skill: 'SPEAKING', score: 7.5 })).toBe(75);
  });

  it('reads Writing against the max score recorded with the attempt', () => {
    expect(
      percentOfAttempt({
        skill: 'WRITING',
        score: 3,
        aiFeedback: JSON.stringify({ maxScore: 5 }),
      }),
    ).toBe(60);
  });

  it('gives no percentage when the scale is unknown', () => {
    expect(percentOfAttempt({ skill: 'SPEAKING', score: null })).toBeNull();
    expect(
      percentOfAttempt({ skill: 'READING', score: 2, questions: 0 }),
    ).toBeNull();
    expect(
      percentOfAttempt({ skill: 'WRITING', score: 3, aiFeedback: 'not json' }),
    ).toBeNull();
    expect(
      percentOfAttempt({ skill: 'WRITING', score: 3, aiFeedback: null }),
    ).toBeNull();
  });

  it('keeps the result inside 0-100', () => {
    expect(percentOfAttempt({ skill: 'READING', score: 9, questions: 5 })).toBe(
      100,
    );
  });
});
