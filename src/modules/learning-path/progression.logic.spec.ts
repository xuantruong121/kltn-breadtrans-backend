import { percentOfAttempt } from './progression.logic';

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
