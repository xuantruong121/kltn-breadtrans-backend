import { pendingForQuiz, pendingSummary } from './translation-review.logic';

describe('translation review counts in the Writing CMS', () => {
  const rows = [{ quizId: 4 }, { quizId: 9 }, { quizId: 4 }];

  it('counts the whole queue and each exercise', () => {
    expect(pendingSummary(rows)).toEqual({ total: 3, byQuiz: { 4: 2, 9: 1 } });
    expect(pendingSummary([])).toEqual({ total: 0, byQuiz: {} });
  });

  it('keeps one exercise when one is named, and its count matches the summary', () => {
    expect(pendingForQuiz(rows, 4)).toHaveLength(
      pendingSummary(rows).byQuiz[4],
    );
    expect(pendingForQuiz(rows, 7)).toEqual([]);
    expect(pendingForQuiz(rows)).toBe(rows);
  });
});
