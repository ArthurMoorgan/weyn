-- Additive: extra photos for an event carousel, alongside the existing
-- single `image` cover field (untouched, still used for cards/thumbnails).
ALTER TABLE "Event" ADD COLUMN "gallery" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
