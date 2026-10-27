import { completedWritingQuizIds } from './writing-exercise-progress';

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
