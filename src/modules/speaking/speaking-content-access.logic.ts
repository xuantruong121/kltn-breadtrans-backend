import type { PracticeLevel } from '@prisma/client';

import {
  advancedPracticePlan,
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
  /** Present when the row was loaded with its practice set. */
  practiceSet?: {
    scope?: string | null;
    level?: PracticeLevel | null;
  } | null;
};

/** The practice set's level; null for TOEIC exam tasks and set-less rows. */
export function speakingPracticeLevel(
  exercise: SpeakingPlanSubject,
): PracticeLevel | null {
  if (exercise.practiceSet?.scope === 'EXAM_INTERNAL') return null;
  return exercise.practiceSet?.level ?? null;
}

/**
 * Lowest plan for this exercise. Standalone practice follows the owner
 * matrix (Mất gốc and Cơ bản free, Trung cấp PLUS, Nâng cao PRO) from its
 * practice set level. TOEIC exam tasks and items with no level keep their
 * stored flag, which then needs PRO.
 */
export function speakingRequiredPlan(
  exercise: SpeakingPlanSubject,
): PracticePlan {
  const level = speakingPracticeLevel(exercise);
  if (level) return requiredPracticePlan('SPEAKING', level);
  return exercise.isPremiumContent ? advancedPracticePlan('SPEAKING') : 'FREE';
}

/** Paid content: its media lives under a private premium/ key. */
export function isPremiumSpeaking(exercise: SpeakingPlanSubject): boolean {
  return speakingRequiredPlan(exercise) !== 'FREE';
}
