/**
 * The translation review queue seen from the Writing CMS (owner 2026-11-19):
 * the tab shows how many translations wait, each "Dịch câu" card how many of
 * its own, and a card opens the queue filtered to that exercise.
 */
export function pendingSummary(rows: Array<{ quizId: number }>) {
  const byQuiz: Record<number, number> = {};
  for (const { quizId } of rows) byQuiz[quizId] = (byQuiz[quizId] ?? 0) + 1;
  return { total: rows.length, byQuiz };
}

/** The rows of one exercise, or all of them when no exercise is named. */
export function pendingForQuiz<T extends { quizId: number }>(
  rows: T[],
  quizId?: number,
): T[] {
  return quizId ? rows.filter((row) => row.quizId === quizId) : rows;
}
