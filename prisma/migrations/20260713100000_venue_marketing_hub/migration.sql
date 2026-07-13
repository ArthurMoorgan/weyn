-- Venue Marketing Hub: win-back conversion tracking, loyalty/referral
-- tracking, a venue-side UTM link builder, and a per-venue brand kit — the
-- venue-dashboard counterpart to organizer's 20260713090000_marketing_hub.
-- All additive. Hand-written, NOT applied against the live DB as part of
-- this change (see that migration's note) — applied deliberately later via
-- `prisma db execute` the same way the migrations before it were.

-- CreateTable: snapshot of who a venue campaign was actually sent to, so
-- win-back conversion (did this guest book again after this send) can be
-- computed after the fact instead of relying on Campaign.recipientCount
-- (a bare number, not a guest list).
CREATE TABLE "VenueCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable: venue-side UTM link builder, mirrors MarketingLink but FK'd
-- to Venue instead of Event.
CREATE TABLE "VenueMarketingLink" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "utmSource" TEXT NOT NULL,
    "utmMedium" TEXT NOT NULL,
    "utmCampaign" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueMarketingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable: loyalty/referral tracking per (venue, guest) — visit-count
-- tier (bronze/silver/gold) is computed live from Reservation history, not
-- stored here; only the stable, shareable referral code + its count is
-- persisted.
CREATE TABLE "VenueLoyalty" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "referralCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueLoyalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable: per-venue branding preferences fed into the AI campaign-copy
-- prompt, same shape as OrganizerBrandKit but keyed by venueId (one owner
-- can run several venues with different branding each).
CREATE TABLE "VenueBrandKit" (
    "venueId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "toneOfVoice" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueBrandKit_pkey" PRIMARY KEY ("venueId")
);

-- CreateIndex
CREATE INDEX "VenueCampaignRecipient_campaignId_idx" ON "VenueCampaignRecipient"("campaignId");
CREATE INDEX "VenueCampaignRecipient_guestEmail_idx" ON "VenueCampaignRecipient"("guestEmail");
CREATE INDEX "VenueMarketingLink_venueId_idx" ON "VenueMarketingLink"("venueId");
CREATE UNIQUE INDEX "VenueLoyalty_referralCode_key" ON "VenueLoyalty"("referralCode");
CREATE UNIQUE INDEX "VenueLoyalty_venueId_guestEmail_key" ON "VenueLoyalty"("venueId", "guestEmail");
CREATE INDEX "VenueLoyalty_venueId_idx" ON "VenueLoyalty"("venueId");

-- AddForeignKey
ALTER TABLE "VenueCampaignRecipient" ADD CONSTRAINT "VenueCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueMarketingLink" ADD CONSTRAINT "VenueMarketingLink_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueLoyalty" ADD CONSTRAINT "VenueLoyalty_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueBrandKit" ADD CONSTRAINT "VenueBrandKit_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FeatureAccess rows for the new venue-marketing-hub flags (free plan: off,
-- pro plan: on — matches every other feature's launch-mode seed). Named
-- distinctly from the organizer-side "utmLinkBuilder"/"referralPrograms"/
-- "marketingCalendar"/"brandKit" flags already in FeatureAccess so the two
-- domains' Pro plans can be toggled independently.
INSERT INTO "FeatureAccess" ("id", "planId", "feature", "enabled")
VALUES
  (gen_random_uuid()::text, 'plan_free', 'venueWinBackCampaigns', false),
  (gen_random_uuid()::text, 'plan_pro', 'venueWinBackCampaigns', true),
  (gen_random_uuid()::text, 'plan_free', 'venueLoyaltyProgram', false),
  (gen_random_uuid()::text, 'plan_pro', 'venueLoyaltyProgram', true),
  (gen_random_uuid()::text, 'plan_free', 'venueUtmLinkBuilder', false),
  (gen_random_uuid()::text, 'plan_pro', 'venueUtmLinkBuilder', true),
  (gen_random_uuid()::text, 'plan_free', 'venueMarketingCalendar', false),
  (gen_random_uuid()::text, 'plan_pro', 'venueMarketingCalendar', true),
  (gen_random_uuid()::text, 'plan_free', 'venueBrandKit', false),
  (gen_random_uuid()::text, 'plan_pro', 'venueBrandKit', true);
