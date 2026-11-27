import type { SrsGrade } from './srs.logic';

/**
 * The grade of one word in the flashcard room, decided by the system from how
 * the learner did in the steps (thesis supervisor 2026-11-26: no self-rating
 * at the end of a word). Pure: the room reports what happened, this decides.
 *
 * The two checks are the multiple-choice meaning (quiz) and typing the word.
 * A skipped check counts as a miss. Two misses: "Học lại"; one miss, or a
 * right spelling found with hints: "Khó"; both right without help: "Tốt",
 * or "Dễ" when the word was also said right or the learner asked for the
 * quick check ("Đã nhớ") and passed it.
 */

export const STEP_RESULTS = ['CORRECT', 'WRONG', 'SKIPPED'] as const;
export type StepResult = (typeof STEP_RESULTS)[number];

export const SPEAKING_RESULTS = [
  'PASSED',
  'FAILED',
  'UNAVAILABLE',
  'SKIPPED',
] as const;
export type SpeakingResult = (typeof SPEAKING_RESULTS)[number];

export type ReviewEvidence = {
  quiz: StepResult;
  typing: StepResult;
  /** Letters revealed by the hint button before the word was typed. */
  typingHints: number;
  /** PASSED only for a real speech recognition match. */
  speaking: SpeakingResult;
  /** "Đã nhớ": the learner said they know it; the room asked only the two checks. */
  quickCheck: boolean;
};

export const MAX_TYPING_HINTS = 50;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/** The evidence a client sent, or null when any field is missing or wrong. */
export function parseReviewEvidence(value: unknown): ReviewEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const hints = v.typingHints;
  if (
    !isOneOf(STEP_RESULTS, v.quiz) ||
    !isOneOf(STEP_RESULTS, v.typing) ||
    !isOneOf(SPEAKING_RESULTS, v.speaking) ||
    typeof v.quickCheck !== 'boolean' ||
    typeof hints !== 'number' ||
    !Number.isInteger(hints) ||
    hints < 0 ||
    hints > MAX_TYPING_HINTS
  )
    return null;
  return {
    quiz: v.quiz,
    typing: v.typing,
    typingHints: hints,
    speaking: v.speaking,
    quickCheck: v.quickCheck,
  };
}

/** The grade the review schedule takes for this word. */
export function gradeFromEvidence(e: ReviewEvidence): SrsGrade {
  const misses =
    (e.quiz === 'CORRECT' ? 0 : 1) + (e.typing === 'CORRECT' ? 0 : 1);
  if (misses >= 2) return 'AGAIN';
  if (misses === 1 || e.typingHints > 0) return 'HARD';
  return e.quickCheck || e.speaking === 'PASSED' ? 'EASY' : 'GOOD';
}
