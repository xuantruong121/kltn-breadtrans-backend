-- Shop cosmetics in use (owner 2026-11-19): the avatar frame and the badge a
-- learner shows were kept only in browser storage and lost on every sign-in.
-- Two nullable columns; no existing row changes.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "avatarFrame" TEXT,
ADD COLUMN "badgeKey" TEXT;
