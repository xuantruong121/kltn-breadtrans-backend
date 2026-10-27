/**
 * Post-submission summary of a TOEIC L&R attempt, computed once on the
 * server from the stored answers and keys so every view shows the same
 * numbers: per question CORRECT / INCORRECT / SKIPPED, per Part, per skill
 * and overall. Only the attempt's own scope (selected Parts) is counted.
 */
export type ReviewStatus = 'CORRECT' | 'INCORRECT' | 'SKIPPED';

export type ReviewTally = {
  total: number;
  correct: number;
  incorrect: number;
  skipped: number;
  /** correct / total, two decimals; null when total is 0. */
  accuracy: number | null;
};

export function reviewStatus(
  selectedIndex: number | null | undefined,
  correctIndex: number,
): ReviewStatus {
  if (selectedIndex === null || selectedIndex === undefined) return 'SKIPPED';
  return selectedIndex === correctIndex ? 'CORRECT' : 'INCORRECT';
}

function tally(statuses: ReviewStatus[]): ReviewTally {
  const correct = statuses.filter((s) => s === 'CORRECT').length;
  const incorrect = statuses.filter((s) => s === 'INCORRECT').length;
  const total = statuses.length;
  return {
    total,
    correct,
    incorrect,
    skipped: total - correct - incorrect,
    accuracy: total ? Math.round((correct / total) * 10000) / 100 : null,
  };
}

export function summarizeLrReview(
  items: Array<{ part: number; status: ReviewStatus }>,
) {
  const parts = [1, 2, 3, 4, 5, 6, 7]
    .map((part) => ({
      part,
      ...tally(items.filter((i) => i.part === part).map((i) => i.status)),
    }))
    .filter((p) => p.total > 0);
  return {
    overall: tally(items.map((i) => i.status)),
    listening: tally(items.filter((i) => i.part <= 4).map((i) => i.status)),
    reading: tally(items.filter((i) => i.part >= 5).map((i) => i.status)),
    parts,
  };
}
