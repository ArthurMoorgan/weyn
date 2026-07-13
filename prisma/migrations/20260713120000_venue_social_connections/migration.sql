-- Venue-dashboard mirror of 20260713110000_organizer_social_connections:
-- real Meta (Instagram + Facebook) account connection + posting for a
-- Venue, a venue-owned guest-marketing subscriber list with real
-- unsubscribe, and send history. All additive — no existing table is
-- altered except SocialAccountConnection, which grows an optional venueId
-- column and drops its NOT NULL on userId to become dual-owned (organizer
-- OR venue, never both — enforced in server/app.js, not the DB). Same
-- "parked, code-complete, inert until env vars are set" pattern as the
-- organizer migration before it — hand-written, NOT run against the live
-- DB as part of this change.

-- AlterTable: SocialAccountConnection becomes dual-owned.
ALTER TABLE "SocialAccountConnection" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "SocialAccountConnection" ADD COLUMN "venueId" TEXT;
DROP INDEX IF EXISTS "SocialAccountConnection_userId_provider_key";
CREATE UNIQUE INDEX "SocialAccountConnection_userId_provider_key" ON "SocialAccountConnection"("userId", "provider");
CREATE UNIQUE INDEX "SocialAccountConnection_venueId_provider_key" ON "SocialAccountConnection"("venueId", "provider");
CREATE INDEX "SocialAccountConnection_venueId_idx" ON "SocialAccountConnection"("venueId");
ALTER TABLE "SocialAccountConnection" ADD CONSTRAINT "SocialAccountConnection_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: history of real Instagram publishes for a venue's marketing
-- campaigns (mirrors SocialPost, which is event-keyed for organizers).
CREATE TABLE "VenueSocialPost" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalPostId" TEXT,
    "copy" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "error" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueSocialPost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VenueSocialPost_venueId_idx" ON "VenueSocialPost"("venueId");

-- CreateTable: venue-owned guest-marketing subscriber list, distinct from
-- Reservation.guestEmail (transactional) and VenueGuestNote (CRM tags).
-- unsubscribeToken backs a real, public, no-auth one-click unsubscribe.
CREATE TABLE "VenueMarketingContact" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "subscribed" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unsubscribeToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueMarketingContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VenueMarketingContact_unsubscribeToken_key" ON "VenueMarketingContact"("unsubscribeToken");
CREATE UNIQUE INDEX "VenueMarketingContact_venueId_email_key" ON "VenueMarketingContact"("venueId", "email");
CREATE INDEX "VenueMarketingContact_venueId_idx" ON "VenueMarketingContact"("venueId");

-- CreateTable: send history for real bulk-email campaigns to a venue's
-- VenueMarketingContact list via server/email.js's sendEmail()/Resend.
CREATE TABLE "VenueEmailCampaignSend" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueEmailCampaignSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VenueEmailCampaignSend_venueId_idx" ON "VenueEmailCampaignSend"("venueId");

-- AddForeignKey
ALTER TABLE "VenueSocialPost" ADD CONSTRAINT "VenueSocialPost_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueMarketingContact" ADD CONSTRAINT "VenueMarketingContact_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueEmailCampaignSend" ADD CONSTRAINT "VenueEmailCampaignSend_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FeatureAccess rows for the two new gated features (free plan: off, pro
-- plan: on — matches the organizer migration's seed).
INSERT INTO "FeatureAccess" ("id", "planId", "feature", "enabled")
VALUES
  (gen_random_uuid()::text, 'plan_free', 'venueSocialAutoPosting', false),
  (gen_random_uuid()::text, 'plan_pro', 'venueSocialAutoPosting', true),
  (gen_random_uuid()::text, 'plan_free', 'venueEmailCampaigns', false),
  (gen_random_uuid()::text, 'plan_pro', 'venueEmailCampaigns', true);
