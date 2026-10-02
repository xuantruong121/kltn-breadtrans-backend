# Migration: 20261001090000_speaking_post_processing_leases_and_idempotency

## Purpose
1. Adds worker lease fencing token and timestamps for speaking feedback and gamification reward processing (`feedbackStartedAt`, `feedbackWorkerId`, `rewardStartedAt`, `rewardWorkerId`).
2. Introduces `SpeakingRewardLedger` with deterministic uniqueness constraint `(submissionId, rewardType, reference)` to guarantee exactly-once business effects across all reward side effects (XP, Bánh Mì, Daily Quests, Badges) under worker crash and retry conditions.

## Rollback Limitations
To rollback this migration:
```sql
DROP TABLE IF EXISTS "SpeakingRewardLedger";

DROP INDEX IF EXISTS "SpeakingSubmission_feedbackStatus_feedbackStartedAt_idx";
DROP INDEX IF EXISTS "SpeakingSubmission_rewardStatus_rewardStartedAt_idx";

ALTER TABLE "SpeakingSubmission"
  DROP COLUMN IF EXISTS "feedbackStartedAt",
  DROP COLUMN IF EXISTS "feedbackWorkerId",
  DROP COLUMN IF EXISTS "rewardStartedAt",
  DROP COLUMN IF EXISTS "rewardWorkerId";
```
Existing SpeakingSubmission rows remain completely valid.
