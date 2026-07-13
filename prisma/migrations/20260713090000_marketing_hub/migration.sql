-- Marketing Hub: ad-platform copy generation, UTM link builder, a simple
-- referral program, and a per-organizer brand kit. All additive — existing
-- MarketingAsset rows stay valid, new tables have no back-reference from
-- existing data. Applied via `prisma db execute` like the migrations before
-- it (see 20260712210000_marketing_social_kit's note) — NOT run against the
-- live DB as part of this change; hand-written now, applied deliberately
-- later.

-- AlterTable: extend the existing per-event generated-copy cache with paid
-- ad-platform variants and two outreach templates (press release,
-- influencer/partner DM). Nullable so old rows keep working until the
-- organizer next hits "Regenerate".
ALTER TABLE "MarketingAsset"
ADD COLUMN "googleAdVariants" JSONB,
ADD COLUMN "metaAdVariants" JSONB,
ADD COLUMN "pressRelease" TEXT,
ADD COLUMN "influencerDm" TEXT;

-- AlterTable: referral attribution on Booking, mirrors the existing
-- utmSource/utmMedium/utmCampaign capture-at-booking-time pattern.
ALTER TABLE "Booking" ADD COLUMN "referredByCodeId" TEXT;

-- CreateTable: UTM link builder — organizer-facing list of trackable links
-- they've generated for an event (actual attribution still flows through
-- Booking.utmSource/etc captured at booking time; this table is just the
-- "here are the links I made, here's roughly how many clicks" view).
CREATE TABLE "MarketingLink" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "utmSource" TEXT NOT NULL,
    "utmMedium" TEXT NOT NULL,
    "utmCampaign" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable: referral program — one code per attendee-per-event, no real
-- payout, just a referral count for a leaderboard/manual perk.
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerName" TEXT,
    "ownerEmail" TEXT,
    "referralCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable: per-organizer branding preferences fed into the AI copy
-- prompt (server/marketing.js) so generated copy stays on-brand.
CREATE TABLE "OrganizerBrandKit" (
    "organizerId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "toneOfVoice" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizerBrandKit_pkey" PRIMARY KEY ("organizerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");
CREATE INDEX "MarketingLink_eventId_idx" ON "MarketingLink"("eventId");
CREATE INDEX "MarketingLink_organizerId_idx" ON "MarketingLink"("organizerId");
CREATE INDEX "ReferralCode_eventId_idx" ON "ReferralCode"("eventId");
CREATE INDEX "ReferralCode_organizerId_idx" ON "ReferralCode"("organizerId");
CREATE INDEX "Booking_referredByCodeId_idx" ON "Booking"("referredByCodeId");

-- AddForeignKey
ALTER TABLE "MarketingLink" ADD CONSTRAINT "MarketingLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingLink" ADD CONSTRAINT "MarketingLink_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizerBrandKit" ADD CONSTRAINT "OrganizerBrandKit_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_referredByCodeId_fkey" FOREIGN KEY ("referredByCodeId") REFERENCES "ReferralCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FeatureAccess rows for the new marketing-hub flags (free plan: off, pro
-- plan: on — matches every other feature's launch-mode seed).
INSERT INTO "FeatureAccess" ("id", "planId", "feature", "enabled")
VALUES
  (gen_random_uuid()::text, 'plan_free', 'adCopyGeneration', false),
  (gen_random_uuid()::text, 'plan_pro', 'adCopyGeneration', true),
  (gen_random_uuid()::text, 'plan_free', 'utmLinkBuilder', false),
  (gen_random_uuid()::text, 'plan_pro', 'utmLinkBuilder', true),
  (gen_random_uuid()::text, 'plan_free', 'referralPrograms', false),
  (gen_random_uuid()::text, 'plan_pro', 'referralPrograms', true),
  (gen_random_uuid()::text, 'plan_free', 'marketingCalendar', false),
  (gen_random_uuid()::text, 'plan_pro', 'marketingCalendar', true),
  (gen_random_uuid()::text, 'plan_free', 'brandKit', false),
  (gen_random_uuid()::text, 'plan_pro', 'brandKit', true);
