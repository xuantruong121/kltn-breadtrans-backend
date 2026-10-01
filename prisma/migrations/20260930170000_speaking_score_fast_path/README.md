# Migration: 20260930170000_speaking_score_fast_path

## Purpose
Enables asynchronous fast-path score completion for Speaking practice exercises.
Adds `SpeakingFeedbackStatus` and `SpeakingRewardStatus` enum types and tracking columns to `SpeakingSubmission`.

## Schema Changes
- Enum `SpeakingFeedbackStatus`: `NOT_REQUESTED`, `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`
- Enum `SpeakingRewardStatus`: `NOT_REQUESTED`, `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`
- Column `feedbackStatus`: defaults to `'NOT_REQUESTED'`, NOT NULL, safe for existing rows.
- Column `feedbackError`: TEXT nullable.
- Column `feedbackProcessedAt`: TIMESTAMP(3) nullable.
- Column `rewardStatus`: defaults to `'NOT_REQUESTED'`, NOT NULL, safe for existing rows.
- Column `rewardError`: TEXT nullable.
- Column `rewardProcessedAt`: TIMESTAMP(3) nullable.
- Indexes: `SpeakingSubmission_feedbackStatus_idx`, `SpeakingSubmission_rewardStatus_idx`.

## Rollback Limitations
PostgreSQL does not natively support dropping ENUM types that are referenced by existing table columns without dropping the columns first.
To safely rollback this migration:
```sql
DROP INDEX IF EXISTS "SpeakingSubmission_feedbackStatus_idx";
DROP INDEX IF EXISTS "SpeakingSubmission_rewardStatus_idx";

ALTER TABLE "SpeakingSubmission"
  DROP COLUMN IF EXISTS "feedbackStatus",
  DROP COLUMN IF EXISTS "feedbackError",
  DROP COLUMN IF EXISTS "feedbackProcessedAt",
  DROP COLUMN IF EXISTS "rewardStatus",
  DROP COLUMN IF EXISTS "rewardError",
  DROP COLUMN IF EXISTS "rewardProcessedAt";

DROP TYPE IF EXISTS "SpeakingFeedbackStatus";
DROP TYPE IF EXISTS "SpeakingRewardStatus";
```
Note: Rolling back will remove the audit trails of post-processing feedback and rewards, but will not alter previously persisted pronunciation scores (`overallScore`), transcripts, or audio files.
