import {
  fitScore,
  itemLevel,
  seedDifficulty,
  successProbability,
  updateAfterAttempt,
} from './ability.logic';

describe('ability model', () => {
  it('predicts 50 % when ability equals difficulty, more when stronger', () => {
    expect(successProbability(0, 0)).toBeCloseTo(0.5);
    expect(successProbability(1, 0)).toBeGreaterThan(0.7);
    expect(successProbability(-1, 0)).toBeLessThan(0.3);
  });

  it('a surprising success raises ability and lowers the item difficulty', () => {
    const r = updateAfterAttempt({
      ability: 0,
      difficulty: 1,
      itemAttempts: 0,
      scorePercent: 100,
    });
    expect(r.ability).toBeGreaterThan(0);
    expect(r.difficulty).toBeLessThan(1);
    expect(r.expected).toBeLessThan(0.5);
  });

  it('an expected result barely moves anything', () => {
    const p = successProbability(0.5, 0) * 100;
    const r = updateAfterAttempt({
      ability: 0.5,
      difficulty: 0,
      itemAttempts: 10,
      scorePercent: p,
    });
    expect(Math.abs(r.ability - 0.5)).toBeLessThan(1e-9);
  });

  it('a busy item moves less than a new one', () => {
    const fresh = updateAfterAttempt({
      ability: 0,
      difficulty: 0,
      itemAttempts: 0,
      scorePercent: 0,
    });
    const busy = updateAfterAttempt({
      ability: 0,
      difficulty: 0,
      itemAttempts: 99,
      scorePercent: 0,
    });
    expect(fresh.difficulty - 0).toBeGreaterThan(busy.difficulty - 0);
  });

  it('fit is highest inside the 60-80 % band', () => {
    expect(fitScore(0.7)).toBe(1);
    expect(fitScore(0.65)).toBeGreaterThan(0.9);
    expect(fitScore(0.2)).toBeLessThan(0.4);
    expect(fitScore(0.99)).toBeLessThan(0.1);
  });

  it('item level and difficulty come from the content tag', () => {
    expect(itemLevel({ min: 'A1', max: 'A2' })).toBe('STARTER');
    expect(itemLevel({ min: 'A2', max: 'A2' })).toBe('BASIC');
    expect(itemLevel({ min: 'B2', max: 'C1' })).toBe('INTERMEDIATE');
    expect(itemLevel({ min: 'C1', max: 'C1' })).toBe('ADVANCED');
    expect(seedDifficulty({ min: 'A1', max: 'A1' })).toBe(-1.25);
  });
});
