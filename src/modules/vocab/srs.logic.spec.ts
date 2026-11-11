import {
  SRS_MAX_INTERVAL_DAYS,
  SRS_MIN_EASE,
  SRS_START,
  isSrsGrade,
  nextReviewAt,
  previewSrs,
  rateSrs,
  srsStateOf,
  type SrsGrade,
  type SrsState,
} from './srs.logic';

const run = (grades: SrsGrade[], from: SrsState = SRS_START) =>
  grades.reduce((state, grade) => rateSrs(state, grade), from);

describe('srs.logic', () => {
  it('spaces a word further apart with each "Tốt"', () => {
    const intervals: number[] = [];
    let state = SRS_START;
    for (let i = 0; i < 6; i++) {
      state = rateSrs(state, 'GOOD');
      intervals.push(state.intervalDays);
    }
    expect(intervals).toEqual([1, 3, 8, 20, 50, 125]);
    expect(state.easeFactor).toBe(2.5);
  });

  it('gives a new word a longer first interval for "Dễ" than for "Tốt"', () => {
    expect(rateSrs(SRS_START, 'HARD').intervalDays).toBe(1);
    expect(rateSrs(SRS_START, 'GOOD').intervalDays).toBe(1);
    expect(rateSrs(SRS_START, 'EASY').intervalDays).toBe(4);
  });

  it('orders the ratings: Khó <= Tốt <= Dễ, and always later than before', () => {
    for (const intervalDays of [1, 2, 3, 7, 20, 90]) {
      for (const easeFactor of [1.3, 2.0, 2.5, 3.0]) {
        const state = { intervalDays, easeFactor, lapses: 0 };
        const p = previewSrs(state);
        expect(p.HARD).toBeGreaterThan(intervalDays);
        expect(p.GOOD).toBeGreaterThanOrEqual(p.HARD);
        expect(p.EASY).toBeGreaterThanOrEqual(p.GOOD);
      }
    }
  });

  it('brings a forgotten word back in ten minutes and counts the lapse', () => {
    const learned = run(['GOOD', 'GOOD', 'GOOD']);
    const lapsed = rateSrs(learned, 'AGAIN');
    expect(lapsed).toEqual({ intervalDays: 0, easeFactor: 2.3, lapses: 1 });
    const now = new Date('2026-11-11T03:00:00.000Z');
    expect(nextReviewAt(lapsed, now).toISOString()).toBe(
      '2026-11-11T03:10:00.000Z',
    );
    expect(previewSrs(learned).AGAIN).toBe(0);
  });

  it('makes a word that keeps being forgotten come back sooner', () => {
    const steady = run(['GOOD', 'GOOD', 'GOOD', 'GOOD']);
    const shaky = run(['GOOD', 'AGAIN', 'GOOD', 'AGAIN', 'GOOD', 'GOOD']);
    expect(shaky.easeFactor).toBeLessThan(steady.easeFactor);
    expect(
      rateSrs({ ...shaky, intervalDays: 10 }, 'GOOD').intervalDays,
    ).toBeLessThan(
      rateSrs({ ...steady, intervalDays: 10 }, 'GOOD').intervalDays,
    );
  });

  it('keeps the ease and the interval inside their bounds', () => {
    const worst = run(Array<SrsGrade>(30).fill('AGAIN'));
    expect(worst.easeFactor).toBe(SRS_MIN_EASE);
    const best = run(Array<SrsGrade>(40).fill('EASY'));
    expect(best.easeFactor).toBe(3);
    expect(best.intervalDays).toBe(SRS_MAX_INTERVAL_DAYS);
  });

  it('schedules the next review by the interval in days', () => {
    const now = new Date('2026-11-11T03:00:00.000Z');
    expect(
      nextReviewAt(
        { intervalDays: 3, easeFactor: 2.5, lapses: 0 },
        now,
      ).toISOString(),
    ).toBe('2026-11-14T03:00:00.000Z');
  });

  it('reads a row written before the columns existed as a new word', () => {
    expect(srsStateOf(null)).toEqual(SRS_START);
    expect(srsStateOf({})).toEqual(SRS_START);
    expect(
      srsStateOf({ intervalDays: -2, easeFactor: 0, lapses: NaN }),
    ).toEqual(SRS_START);
    expect(srsStateOf({ intervalDays: 7, easeFactor: 9, lapses: 2 })).toEqual({
      intervalDays: 7,
      easeFactor: 3,
      lapses: 2,
    });
  });

  it('accepts only the four ratings', () => {
    expect(isSrsGrade('GOOD')).toBe(true);
    expect(isSrsGrade('good')).toBe(false);
    expect(isSrsGrade(2)).toBe(false);
    expect(isSrsGrade(undefined)).toBe(false);
  });
});
