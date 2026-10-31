/**
 * Progression rules for the internal practice levels (Mất gốc → Nâng cao):
 * how an attempt becomes a percentage, and when the next level opens. Levels
 * are practice bands, not CEFR levels or certificates. No Prisma, no I/O.
 */
type AttemptScore =
  /** Stored as the count of correct answers. */
  | { skill: 'LISTENING' | 'READING'; score: number | null; questions: number }
  /** Stored per task on its own scale; `aiFeedback` records that scale. */
  | { skill: 'WRITING'; score: number | null; aiFeedback: string | null }
  /** `overallScore`, 0-10. */
  | { skill: 'SPEAKING'; score: number | null };

const toPercent = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));

function writingMaxScore(aiFeedback: string | null) {
  if (!aiFeedback) return null;
  try {
    const parsed = JSON.parse(aiFeedback) as { maxScore?: unknown };
    return typeof parsed.maxScore === 'number' && parsed.maxScore > 0
      ? parsed.maxScore
      : null;
  } catch {
    return null;
  }
}

/** An attempt on the common 0-100 scale; null when it has no usable score. */
export function percentOfAttempt(attempt: AttemptScore): number | null {
  if (attempt.score === null) return null;
  if (attempt.skill === 'SPEAKING') return toPercent(attempt.score * 10);
  if (attempt.skill === 'WRITING') {
    const max = writingMaxScore(attempt.aiFeedback);
    return max === null ? null : toPercent((attempt.score / max) * 100);
  }
  return attempt.questions > 0
    ? toPercent((attempt.score / attempt.questions) * 100)
    : null;
}
