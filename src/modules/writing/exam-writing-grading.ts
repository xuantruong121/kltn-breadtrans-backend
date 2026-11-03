/**
 * A TOEIC exam Writing answer is stored when the section closes and graded
 * afterwards, so the learner never waits for the provider and a provider
 * failure cannot lose the text. While it waits its Submission has no score;
 * failed tries are counted in aiFeedback, which needs no schema change.
 */
export const EXAM_WRITING_MAX_TRIES = 5;
/** Waits this long before a retry, so the first pass can finish on its own. */
export const EXAM_WRITING_RETRY_AFTER_MS = 2 * 60 * 1000;
/** After this a still ungraded answer is reported as failed. */
export const EXAM_WRITING_GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

export function examWritingTries(aiFeedback: string | null): number {
  try {
    const tries = (JSON.parse(aiFeedback ?? '{}') as { gradingTries?: unknown })
      .gradingTries;
    return typeof tries === 'number' ? tries : 0;
  } catch {
    return 0;
  }
}

export function examWritingGaveUp(
  row: { aiFeedback: string | null; submittedAt: Date },
  now: Date,
): boolean {
  return (
    examWritingTries(row.aiFeedback) >= EXAM_WRITING_MAX_TRIES ||
    now.getTime() - row.submittedAt.getTime() >= EXAM_WRITING_GIVE_UP_AFTER_MS
  );
}
