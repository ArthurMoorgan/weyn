-- Social Media Kit: adds an Instagram/WhatsApp Story text overlay, a
-- WhatsApp-broadcast-list variant (distinct tone from the existing group
-- message), and a T-7/T-3/T-1/day-of countdown posting schedule to the
-- existing per-event Marketing tab. All nullable/additive so existing
-- MarketingAsset rows stay valid until next regenerate. Applied via
-- `prisma db execute` for the same reason as the migrations before it —
-- `prisma migrate diff` against the live DB also surfaces unrelated
-- pre-existing drift.

-- AlterTable
ALTER TABLE "MarketingAsset"
ADD COLUMN "instagramStory" TEXT,
ADD COLUMN "whatsappBroadcast" TEXT,
ADD COLUMN "schedule" JSONB;
