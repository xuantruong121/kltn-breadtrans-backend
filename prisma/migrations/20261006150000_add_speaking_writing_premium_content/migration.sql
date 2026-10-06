-- Additive Phase 4B2 content classification. Existing content remains free.
ALTER TYPE "PlanFeatureKey" ADD VALUE 'PREMIUM_SPEAKING_CONTENT';
ALTER TYPE "PlanFeatureKey" ADD VALUE 'PREMIUM_WRITING_CONTENT';

ALTER TABLE "SpeakingExercise"
  ADD COLUMN "isPremiumContent" BOOLEAN NOT NULL DEFAULT false;
