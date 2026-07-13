-- Organizer social/email growth suite: real Meta (Instagram + Facebook)
-- account connection + posting, an organizer-owned email subscriber list
-- with real unsubscribe, and send history. All additive — no existing
-- table is altered. Hand-written, applied via `prisma db execute` like
-- 20260713090000_marketing_hub before it — NOT run against the live DB as
-- part of this change.

-- CreateTable: one Meta connection per organizer (userId, provider) —
-- accessTokenEnc is AES-256-GCM ciphertext (server/crypto-secrets.js),
-- never a plaintext token at rest.
CREATE TABLE "SocialAccountConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "igBusinessAccountId" TEXT,
    "pageId" TEXT,
    "pageName" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccountConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialAccountConnection_userId_provider_key" ON "SocialAccountConnection"("userId", "provider");
CREATE INDEX "SocialAccountConnection_userId_idx" ON "SocialAccountConnection"("userId");

-- CreateTable: history of real Instagram publishes, keyed per event so the
-- UI can show "already posted" and block accidental double-posts.
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalPostId" TEXT,
    "copy" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "error" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SocialPost_eventId_idx" ON "SocialPost"("eventId");
CREATE INDEX "SocialPost_organizerId_idx" ON "SocialPost"("organizerId");

-- CreateTable: organizer-owned email subscriber list, distinct from
-- ticket-buyer Booking.email. unsubscribeToken backs a real, public,
-- no-auth one-click unsubscribe link — a legal requirement for real bulk
-- email, not optional.
CREATE TABLE "MarketingContact" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "subscribed" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unsubscribeToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketingContact_unsubscribeToken_key" ON "MarketingContact"("unsubscribeToken");
CREATE UNIQUE INDEX "MarketingContact_organizerId_email_key" ON "MarketingContact"("organizerId", "email");
CREATE INDEX "MarketingContact_organizerId_idx" ON "MarketingContact"("organizerId");

-- CreateTable: send history for real bulk-email campaigns via
-- server/email.js's sendEmail()/Resend wrapper.
CREATE TABLE "EmailCampaignSend" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCampaignSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailCampaignSend_organizerId_idx" ON "EmailCampaignSend"("organizerId");

-- AddForeignKey
ALTER TABLE "SocialAccountConnection" ADD CONSTRAINT "SocialAccountConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingContact" ADD CONSTRAINT "MarketingContact_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailCampaignSend" ADD CONSTRAINT "EmailCampaignSend_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FeatureAccess rows for the two new gated features (free plan: off, pro
-- plan: on — matches every other feature's launch-mode seed).
INSERT INTO "FeatureAccess" ("id", "planId", "feature", "enabled")
VALUES
  (gen_random_uuid()::text, 'plan_free', 'socialAutoPosting', false),
  (gen_random_uuid()::text, 'plan_pro', 'socialAutoPosting', true),
  (gen_random_uuid()::text, 'plan_free', 'emailCampaigns', false),
  (gen_random_uuid()::text, 'plan_pro', 'emailCampaigns', true);
