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

/**
 * What a learner may see of each question after submitting (owner
 * 2026-11-11): the key, the worded answer and the explanation only for a
 * question they answered. A skipped question keeps its text and choices and
 * nothing else, so answering a few questions and submitting does not hand out
 * the key of the whole exam. A listening transcript gives the answers of its
 * group away, so it is shown only when at least one question of the group was
 * answered.
 */
export function hideUnansweredKeys<
  T extends {
    groupId: number;
    selectedIndex: number | null;
    correctIndex: number | null;
    standardAnswer: string | null;
    explanation: string | null;
    transcript: string | null;
  },
>(questions: T[]): T[] {
  const answeredGroups = new Set(
    questions.filter((q) => q.selectedIndex !== null).map((q) => q.groupId),
  );
  return questions.map((q) => ({
    ...q,
    transcript: answeredGroups.has(q.groupId) ? q.transcript : null,
    ...(q.selectedIndex === null
      ? { correctIndex: null, standardAnswer: null, explanation: null }
      : {}),
  }));
}
