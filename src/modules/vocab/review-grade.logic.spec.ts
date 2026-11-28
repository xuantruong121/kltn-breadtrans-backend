import {
  gradeFromEvidence,
  parseReviewEvidence,
  type ReviewEvidence,
} from './review-grade.logic';

const clean: ReviewEvidence = {
  quiz: 'CORRECT',
  typing: 'CORRECT',
  typingHints: 0,
  speaking: 'SKIPPED',
  quickCheck: false,
};
const evidence = (over: Partial<ReviewEvidence>): ReviewEvidence => ({
  ...clean,
  ...over,
});

describe('gradeFromEvidence (the rule the owner chose on 2026-11-26)', () => {
  it.each<[string, Partial<ReviewEvidence>, string]>([
    ['both checks wrong', { quiz: 'WRONG', typing: 'WRONG' }, 'AGAIN'],
    ['both checks skipped', { quiz: 'SKIPPED', typing: 'SKIPPED' }, 'AGAIN'],
    ['one wrong, one skipped', { quiz: 'WRONG', typing: 'SKIPPED' }, 'AGAIN'],
    [
      'both wrong even when the word was said right',
      { quiz: 'WRONG', typing: 'WRONG', speaking: 'PASSED' },
      'AGAIN',
    ],
    ['the quiz wrong', { quiz: 'WRONG' }, 'HARD'],
    ['the typing wrong', { typing: 'WRONG' }, 'HARD'],
    ['one check skipped', { quiz: 'SKIPPED' }, 'HARD'],
    ['typed right with a hint', { typingHints: 1 }, 'HARD'],
    [
      'a hint outweighs a spoken pass',
      { typingHints: 2, speaking: 'PASSED' },
      'HARD',
    ],
    [
      'a hint outweighs the quick check',
      { typingHints: 1, quickCheck: true },
      'HARD',
    ],
    ['both right, speaking skipped', {}, 'GOOD'],
    ['both right, speaking failed', { speaking: 'FAILED' }, 'GOOD'],
    ['both right, no microphone', { speaking: 'UNAVAILABLE' }, 'GOOD'],
    ['both right and said right', { speaking: 'PASSED' }, 'EASY'],
    ['quick check passed', { quickCheck: true }, 'EASY'],
    [
      'quick check with one wrong answer',
      { quickCheck: true, typing: 'WRONG' },
      'HARD',
    ],
    [
      'quick check with both wrong',
      { quickCheck: true, quiz: 'WRONG', typing: 'WRONG' },
      'AGAIN',
    ],
  ])('%s → %s', (_name, over, grade) => {
    expect(gradeFromEvidence(evidence(over))).toBe(grade);
  });
});

describe('parseReviewEvidence', () => {
  it('reads a complete report', () => {
    expect(parseReviewEvidence({ ...clean, typingHints: 3 })).toEqual({
      ...clean,
      typingHints: 3,
    });
  });

  it('drops fields it does not know', () => {
    expect(parseReviewEvidence({ ...clean, grade: 'EASY' })).toEqual(clean);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'EASY'],
    ['an array', [clean]],
    ['an unknown quiz result', { ...clean, quiz: 'RIGHT' }],
    ['an unknown speaking result', { ...clean, speaking: 'OK' }],
    ['a missing field', { quiz: 'CORRECT', typing: 'CORRECT' }],
    ['negative hints', { ...clean, typingHints: -1 }],
    ['fractional hints', { ...clean, typingHints: 1.5 }],
    ['hints as text', { ...clean, typingHints: '2' }],
    ['too many hints', { ...clean, typingHints: 51 }],
    ['quick check as text', { ...clean, quickCheck: 'true' }],
  ])('rejects %s', (_name, value) => {
    expect(parseReviewEvidence(value)).toBeNull();
  });
});
