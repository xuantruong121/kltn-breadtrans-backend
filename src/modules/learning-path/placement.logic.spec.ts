import {
  levelFromScore,
  levelsUpTo,
  maxLevel,
  placeFromScores,
  PRACTICE_LEVEL_LABEL,
} from './placement.logic';

describe('placement logic', () => {
  it('maps a 0-100 skill score to the four internal levels', () => {
    expect(levelFromScore(0)).toBe('STARTER');
    expect(levelFromScore(29.9)).toBe('STARTER');
    expect(levelFromScore(30)).toBe('BASIC');
    expect(levelFromScore(54)).toBe('BASIC');
    expect(levelFromScore(55)).toBe('INTERMEDIATE');
    expect(levelFromScore(74)).toBe('INTERMEDIATE');
    expect(levelFromScore(75)).toBe('ADVANCED');
    expect(levelFromScore(100)).toBe('ADVANCED');
  });

  it('places every skill and takes the median overall', () => {
    const p = placeFromScores({
      LISTENING: 80,
      READING: 60,
      SPEAKING: 40,
      WRITING: 10,
    });
    expect(p.skills).toEqual({
      LISTENING: 'ADVANCED',
      READING: 'INTERMEDIATE',
      SPEAKING: 'BASIC',
      WRITING: 'STARTER',
    });
    // Even count: the lower median, so the learner is not over-placed.
    expect(p.overall).toBe('BASIC');
    expect(p.partial).toBe(false);
  });

  it('places only completed skills and flags a partial result', () => {
    const p = placeFromScores({ LISTENING: 70, READING: 50, SPEAKING: null });
    expect(p.skills.SPEAKING).toBeNull();
    expect(p.skills.WRITING).toBeNull();
    expect(p.overall).toBe('BASIC');
    expect(p.partial).toBe(true);
  });

  it('has no overall level without any completed skill', () => {
    expect(placeFromScores({})).toEqual({
      skills: {
        LISTENING: null,
        READING: null,
        SPEAKING: null,
        WRITING: null,
      },
      overall: null,
      partial: true,
    });
  });

  it('a genuine zero is a placement, not missing data', () => {
    expect(placeFromScores({ READING: 0 }).skills.READING).toBe('STARTER');
  });

  it('lists the levels opened up to a placement', () => {
    expect(levelsUpTo('STARTER')).toEqual(['STARTER']);
    expect(levelsUpTo('INTERMEDIATE')).toEqual([
      'STARTER',
      'BASIC',
      'INTERMEDIATE',
    ]);
    expect(maxLevel('BASIC', 'ADVANCED')).toBe('ADVANCED');
  });

  it('labels are the internal Vietnamese names, never CEFR codes', () => {
    for (const label of Object.values(PRACTICE_LEVEL_LABEL))
      expect(label).not.toMatch(/\b[ABC][12]\b|CEFR/);
  });
});
