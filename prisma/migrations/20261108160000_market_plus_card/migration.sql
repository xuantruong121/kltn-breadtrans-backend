-- A 7-day Plus card bought with Banh Mi in the shop (owner, 2026-11-08):
-- its subscription term and its history event get their own values.
ALTER TYPE "SubscriptionSource" ADD VALUE IF NOT EXISTS 'MARKET';
ALTER TYPE "SubscriptionEventType" ADD VALUE IF NOT EXISTS 'MARKET_REWARD';
