-- AlterTable
ALTER TABLE "MarketProduct" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "MarketProduct" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "MarketProduct" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "MarketProduct" ADD COLUMN IF NOT EXISTS "rarity" TEXT NOT NULL DEFAULT 'COMMON';
ALTER TABLE "MarketProduct" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Deterministic Backfill for existing rows
UPDATE "MarketProduct" SET "slug" = 'badge-star', "category" = 'BADGE', "rarity" = 'COMMON', "description" = 'Huy hiệu Ngôi Sao vinh danh học viên tích cực' WHERE "id" = 1 AND ("slug" IS NULL OR "slug" = '');
UPDATE "MarketProduct" SET "slug" = 'frame-orange', "category" = 'AVATAR_FRAME', "rarity" = 'RARE', "description" = 'Khung avatar Cam năng động phong cách BreadTrans' WHERE "id" = 2 AND ("slug" IS NULL OR "slug" = '');
UPDATE "MarketProduct" SET "slug" = 'streak-freeze', "category" = 'BOOST', "rarity" = 'RARE', "description" = 'Bảo vệ chuỗi ngày học nếu lỡ bận rộn 1 ngày' WHERE "id" = 3 AND ("slug" IS NULL OR "slug" = '');
UPDATE "MarketProduct" SET "slug" = 'pet-bun', "category" = 'BOOST', "rarity" = 'EPIC', "description" = 'Thú cưng Bun phiên bản đặc biệt đồng hành cùng bạn' WHERE "id" = 4 AND ("slug" IS NULL OR "slug" = '');
UPDATE "MarketProduct" SET "slug" = 'product-' || "id" WHERE "slug" IS NULL OR "slug" = '';

-- AlterColumn to NOT NULL
ALTER TABLE "MarketProduct" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketProduct_slug_key" ON "MarketProduct"("slug");
