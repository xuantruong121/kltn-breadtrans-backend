import {
  advancedPracticePlan,
  type CefrRange,
  parseCefrRange,
  type PracticePlan,
  requiredPracticePlan,
} from '../subscription/practice-level';

/**
 * The fields the Speaking plan rule reads. Pure: the access service and the
 * CMS (which picks the storage of a reference clip) share it, so a clip is
 * stored where the learner endpoint will look for it.
 */
export type SpeakingPlanSubject = {
  isPremiumContent: boolean;
  /** Present on full rows; carries the authored CEFR tag. */
  title?: string | null;
  /** Present when the row was loaded with its practice set. */
  practiceSet?: { scope?: string | null; level?: string | null } | null;
};

/** Practice set level, else the title tag; null for TOEIC exam tasks. */
export function speakingCefrRange(
  exercise: SpeakingPlanSubject,
): CefrRange | null {
  if (exercise.practiceSet?.scope === 'EXAM_INTERNAL') return null;
  return (
    parseCefrRange(exercise.practiceSet?.level) ??
    parseCefrRange(exercise.title)
  );
}

/**
 * Lowest plan for this exercise. Standalone practice follows the owner
 * matrix (A1/A2 free, B1+ paid) from its practice set level, else from the
 * CEFR tag of its title. TOEIC exam tasks and untagged items keep their
 * stored flag, which then needs PRO.
 */
export function speakingRequiredPlan(
  exercise: SpeakingPlanSubject,
): PracticePlan {
  const range = speakingCefrRange(exercise);
  if (range) return requiredPracticePlan('SPEAKING', range);
  return exercise.isPremiumContent ? advancedPracticePlan('SPEAKING') : 'FREE';
}

/** Paid content: its media lives under a private premium/ key. */
export function isPremiumSpeaking(exercise: SpeakingPlanSubject): boolean {
  return speakingRequiredPlan(exercise) !== 'FREE';
}
