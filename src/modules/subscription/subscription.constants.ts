import { PlanFeatureKey } from '@prisma/client';

export const PLAN_FEATURE_KEYS: readonly string[] = Object.freeze([
  PlanFeatureKey.AI_SPEAKING_ASSESSMENT,
  PlanFeatureKey.AI_WRITING_REVIEW,
  PlanFeatureKey.AI_TUTOR_MESSAGE,
  PlanFeatureKey.AI_EXPLANATION,
  PlanFeatureKey.PREMIUM_VOCAB,
  PlanFeatureKey.PREMIUM_READING,
  PlanFeatureKey.PREMIUM_LISTENING,
  PlanFeatureKey.PREMIUM_SPEAKING_CONTENT,
  PlanFeatureKey.PREMIUM_WRITING_CONTENT,
  // Generated Prisma client is refreshed separately; the database enum is durable.
  'COURSE_LIBRARY_ACCESS',
]);

export function isPlanFeatureKey(value: string): value is PlanFeatureKey {
  return PLAN_FEATURE_KEYS.includes(value);
}
