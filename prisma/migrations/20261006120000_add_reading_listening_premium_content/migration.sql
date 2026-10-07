-- Additive Phase 4B1 content classification. Existing quizzes remain free.
ALTER TYPE "PlanFeatureKey" ADD VALUE 'PREMIUM_READING';
ALTER TYPE "PlanFeatureKey" ADD VALUE 'PREMIUM_LISTENING';

ALTER TABLE "Quiz"
  ADD COLUMN "isPremiumContent" BOOLEAN NOT NULL DEFAULT false;
