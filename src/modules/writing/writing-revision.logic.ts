/**
 * Guided rewrite of a graded Writing practice answer (owner 2026-11-11).
 *
 * After a grade the learner may correct the text and hand it in again, at most
 * MAX_WRITING_REVISIONS times for one first submission. A revision is graded
 * with the same rubric on its own merits; the grader is also given the earlier
 * corrections so its comment can say what changed. A revision earns no reward.
 *
 * What was fixed is decided here, from the texts: an earlier correction counts
 * as fixed when the quoted mistake is no longer in the new text. The grader's
 * word is not used for that.
 *
 * Pure: no Prisma, no I/O.
 */

export const MAX_WRITING_REVISIONS = 2;

export type RevisionCorrection = {
  original: string;
  corrected: string;
  explanation: string;
};

export type RevisionCriterion = {
  key: string;
  label: string;
  score: number;
  max: number;
};

/** One graded text of a chain: the first submission (number 0) or a revision. */
export type RevisionAttempt = {
  submissionId: number;
  number: number;
  answer: string;
  score: number;
  maxScore: number;
  criteria: RevisionCriterion[];
  corrections: RevisionCorrection[];
  suggestions: string[];
  submittedAt: Date;
};

const norm = (s: string) =>
  s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

export function sameText(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

/**
 * A stored practice grade (Submission.aiFeedback, PRACTICE_WRITING_V1) as a
 * chain entry, or null when the row holds no usable practice grade: exam
 * Writing answers and old one-paragraph grades cannot be revised.
 */
export function storedAttempt(row: {
  id: number;
  submittedAt: Date;
  aiFeedback: string | null;
  answer: unknown;
}): Omit<RevisionAttempt, 'number'> | null {
  if (typeof row.answer !== 'string' || !row.answer.trim() || !row.aiFeedback)
    return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(row.aiFeedback) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    parsed.rubricVersion !== 'PRACTICE_WRITING_V1' ||
    !Array.isArray(parsed.criteria) ||
    typeof parsed.score !== 'number' ||
    typeof parsed.maxScore !== 'number' ||
    parsed.maxScore <= 0
  )
    return null;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    submissionId: row.id,
    answer: row.answer,
    score: parsed.score,
    maxScore: parsed.maxScore,
    criteria: (parsed.criteria as Array<Record<string, unknown>>)
      .filter((c) => typeof c?.key === 'string')
      .map((c) => ({
        key: String(c.key),
        label: text(c.label) || String(c.key),
        score: Number(c.score) || 0,
        max: Number(c.max) || 0,
      })),
    corrections: (Array.isArray(parsed.corrections) ? parsed.corrections : [])
      .map((c: Record<string, unknown>) => ({
        original: text(c?.original),
        corrected: text(c?.corrected),
        explanation: text(c?.explanation),
      }))
      .filter((c) => c.original && c.corrected),
    suggestions: (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .filter((s): s is string => typeof s === 'string' && !!s.trim())
      .slice(0, 8),
    submittedAt: row.submittedAt,
  };
}

/** Numbers a chain in the order it was written: 0 is the first submission. */
export function numberChain(
  attempts: Array<Omit<RevisionAttempt, 'number'>>,
): RevisionAttempt[] {
  return [...attempts]
    .sort(
      (a, b) =>
        a.submittedAt.getTime() - b.submittedAt.getTime() ||
        a.submissionId - b.submissionId,
    )
    .map((attempt, number) => ({ ...attempt, number }));
}

export type RevisionRefusal = 'LIMIT' | 'UNCHANGED';

/** Whether one more revision of this chain may be graded. */
export function revisionGate(
  chain: RevisionAttempt[],
  newAnswer: string,
): { ok: true } | { ok: false; reason: RevisionRefusal } {
  if (chain.length - 1 >= MAX_WRITING_REVISIONS)
    return { ok: false, reason: 'LIMIT' };
  const latest = chain[chain.length - 1];
  if (latest && sameText(latest.answer, newAnswer))
    return { ok: false, reason: 'UNCHANGED' };
  return { ok: true };
}

/**
 * Earlier corrections against the new text. Fixed: the quoted mistake is gone.
 * Remaining: it is still there, character for character apart from case and
 * spacing.
 */
export function correctionsStatus(
  corrections: RevisionCorrection[],
  newAnswer: string,
) {
  const haystack = norm(newAnswer);
  // Whole words only: "She ask" is gone from "She asks for a refund".
  const stillThere = (quote: string) =>
    new RegExp(
      `(?<![a-z0-9])${norm(quote).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
    ).test(haystack);
  const fixed: RevisionCorrection[] = [];
  const remaining: RevisionCorrection[] = [];
  for (const item of corrections)
    (stillThere(item.original) ? remaining : fixed).push(item);
  return { fixed, remaining };
}

export type RevisionComparison = {
  previousSubmissionId: number;
  previousAnswer: string;
  scoreBefore: number;
  scoreAfter: number;
  maxScore: number;
  criteria: Array<{
    key: string;
    label: string;
    before: number | null;
    after: number;
    max: number;
  }>;
  fixed: RevisionCorrection[];
  remaining: RevisionCorrection[];
};

export function compareRevision(
  previous: RevisionAttempt,
  current: RevisionAttempt,
): RevisionComparison {
  return {
    previousSubmissionId: previous.submissionId,
    previousAnswer: previous.answer,
    scoreBefore: previous.score,
    scoreAfter: current.score,
    maxScore: current.maxScore,
    criteria: current.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      before: previous.criteria.find((p) => p.key === c.key)?.score ?? null,
      after: c.score,
      max: c.max,
    })),
    ...correctionsStatus(previous.corrections, current.answer),
  };
}

/**
 * What the result page needs about one submission of a chain: where it stands,
 * whether it may still be revised, and how it compares with the text before.
 * Only the latest text of a chain can be revised.
 */
export function revisionView(chain: RevisionAttempt[], submissionId: number) {
  const current = chain.find((a) => a.submissionId === submissionId);
  if (!current) return null;
  const used = chain.length - 1;
  const previous = current.number > 0 ? chain[current.number - 1] : null;
  return {
    rootSubmissionId: chain[0].submissionId,
    number: current.number,
    used,
    limit: MAX_WRITING_REVISIONS,
    remaining: Math.max(0, MAX_WRITING_REVISIONS - used),
    isLatest: current.number === used,
    canRevise: current.number === used && used < MAX_WRITING_REVISIONS,
    chain: chain.map((a) => ({
      submissionId: a.submissionId,
      number: a.number,
      score: a.score,
      maxScore: a.maxScore,
      submittedAt: a.submittedAt,
    })),
    comparison: previous ? compareRevision(previous, current) : null,
  };
}

/** The earlier text and its feedback, as handed to the grader. */
export function revisionGraderInput(previous: RevisionAttempt) {
  return {
    previousResponse: previous.answer,
    corrections: previous.corrections.map((c) => ({
      original: c.original,
      corrected: c.corrected,
    })),
    suggestions: previous.suggestions,
  };
}
