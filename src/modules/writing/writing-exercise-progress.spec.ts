import {
  completedWritingQuizIds,
  writingCompletionXp,
} from './writing-exercise-progress';

describe('completedWritingQuizIds', () => {
  const questions = [
    { id: 1, quizId: 17 },
    { id: 2, quizId: 17 },
    { id: 3, quizId: 17 },
    { id: 9, quizId: 7 },
  ];

  it('does not complete a multi-task exercise after one graded task', () => {
    expect(completedWritingQuizIds(questions, [1])).toEqual(new Set());
  });

  it('completes an exercise once every task is graded', () => {
    expect(completedWritingQuizIds(questions, [1, 2, 3])).toEqual(
      new Set([17]),
    );
  });

  it('completes a single-task quiz with its one graded task', () => {
    expect(completedWritingQuizIds(questions, [9, 1])).toEqual(new Set([7]));
  });
});

describe('writingCompletionXp', () => {
  it('awards one XP per percent of the final exercise score', () => {
    expect(writingCompletionXp(0)).toBe(0);
    expect(writingCompletionXp(50)).toBe(50);
    expect(writingCompletionXp(75)).toBe(75);
    expect(writingCompletionXp(92)).toBe(92);
    expect(writingCompletionXp(100)).toBe(100);
  });

  it('rounds to the nearest integer and clamps invalid values', () => {
    expect(writingCompletionXp(91.6)).toBe(92);
    expect(writingCompletionXp(120)).toBe(100);
    expect(writingCompletionXp(-5)).toBe(0);
    expect(writingCompletionXp(Number.NaN)).toBe(0);
  });
});
