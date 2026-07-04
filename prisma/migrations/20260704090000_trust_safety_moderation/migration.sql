-- Trust & safety: event discovery moderation (see server/moderation.js)
CREATE TYPE "DiscoveryStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'DISCOVERY_LIMITED', 'MANUAL_REVIEW', 'DISCOVERY_BLOCKED');

ALTER TABLE "Event" ADD COLUMN "discoveryStatus" "DiscoveryStatus" NOT NULL DEFAULT 'PENDING_REVIEW';
CREATE INDEX "Event_discoveryStatus_idx" ON "Event"("discoveryStatus");

-- Existing events predate this system entirely — approve them outright
-- rather than retroactively subjecting live events to a review they were
-- never created under (matches the "never punish what already worked" spirit).
UPDATE "Event" SET "discoveryStatus" = 'APPROVED' WHERE "deletedAt" IS NULL;

CREATE TABLE "ModerationResult" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "ruleFlags" TEXT[],
    "qualityScore" INTEGER,
    "trustScore" INTEGER,
    "spamRisk" INTEGER,
    "fraudRisk" INTEGER,
    "aiConfidence" INTEGER,
    "aiFlags" TEXT[],
    "reasoning" TEXT[],
    "aiConfigured" BOOLEAN NOT NULL DEFAULT false,
    "resultingStatus" "DiscoveryStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModerationResult_eventId_createdAt_idx" ON "ModerationResult"("eventId", "createdAt");

ALTER TABLE "ModerationResult" ADD CONSTRAINT "ModerationResult_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
