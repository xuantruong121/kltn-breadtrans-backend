-- AlterTable: add workerId for lease-token fencing in the speaking assessment pipeline
-- This column was previously applied via `prisma db push` and must now be formalized
-- so that `prisma migrate deploy` on a fresh database succeeds without manual intervention.
ALTER TABLE "SpeakingSubmission" ADD COLUMN "workerId" TEXT;
