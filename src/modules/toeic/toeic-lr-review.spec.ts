import { reviewStatus, summarizeLrReview } from './toeic-lr-review';

describe('TOEIC L&R post-submission summary', () => {
  it('classifies each question from the stored answer and key', () => {
    expect(reviewStatus(2, 2)).toBe('CORRECT');
    expect(reviewStatus(1, 2)).toBe('INCORRECT');
    expect(reviewStatus(null, 2)).toBe('SKIPPED');
    expect(reviewStatus(undefined, 0)).toBe('SKIPPED');
  });

  it('counts correct + incorrect + skipped = total per Part, skill and overall', () => {
    const s = summarizeLrReview([
      { part: 1, status: 'CORRECT' },
      { part: 1, status: 'INCORRECT' },
      { part: 2, status: 'SKIPPED' },
      { part: 6, status: 'CORRECT' },
    ]);
    expect(s.overall).toEqual({
      total: 4,
      correct: 2,
      incorrect: 1,
      skipped: 1,
      accuracy: 50,
    });
    expect(s.listening).toEqual({
      total: 3,
      correct: 1,
      incorrect: 1,
      skipped: 1,
      accuracy: 33.33,
    });
    expect(s.reading).toEqual({
      total: 1,
      correct: 1,
      incorrect: 0,
      skipped: 0,
      accuracy: 100,
    });
    // Only Parts that are in scope appear (a part practice lists its own).
    expect(s.parts.map((p) => p.part)).toEqual([1, 2, 6]);
    for (const p of s.parts)
      expect(p.correct + p.incorrect + p.skipped).toBe(p.total);
  });

  it('an empty skill has accuracy null, not 0', () => {
    const s = summarizeLrReview([{ part: 5, status: 'CORRECT' }]);
    expect(s.listening).toEqual({
      total: 0,
      correct: 0,
      incorrect: 0,
      skipped: 0,
      accuracy: null,
    });
  });
});
