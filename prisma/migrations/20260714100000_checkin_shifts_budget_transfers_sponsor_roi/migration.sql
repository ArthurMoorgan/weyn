-- Additive-only migration for 5 of the 9 new organizer features (the other
-- 4 — group discounts, QR flyer generator, NPS survey, birthday automation —
-- either need no schema change or touch a table that isn't live yet, see
-- note below). Applied directly via `prisma db execute` + `migrate resolve
-- --applied`, same pattern as 20260714090000_venue_waitlist, because this
-- DB (Neon, pooled connection) doesn't permit the shadow-database creation
-- `migrate dev` needs.
--
-- Deliberately does NOT touch MarketingContact (birthday column lives on it
-- in schema.prisma now, for the "contact_birthday" automation trigger) —
-- that table doesn't exist in this DB yet, it's one of the four
-- pending-but-unapplied migrations already parked ahead of this one
-- (marketing_hub, venue_marketing_hub, organizer_social_connections,
-- venue_social_connections, per 20260714090000_venue_waitlist's own note).
-- Once marketing_hub is applied, MarketingContact will already include
-- `birthday` since it's part of this repo's current schema.prisma.

-- ---- QR check-in scanning ----
CREATE TYPE "CheckInStatus" AS ENUM ('VALID', 'DUPLICATE', 'INVALID');

CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketId" TEXT,
    "bookingId" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedBy" TEXT,
    "method" TEXT NOT NULL DEFAULT 'qr',
    "status" "CheckInStatus" NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckIn_eventId_idx" ON "CheckIn"("eventId");
CREATE INDEX "CheckIn_ticketId_idx" ON "CheckIn"("ticketId");
CREATE INDEX "CheckIn_eventId_status_idx" ON "CheckIn"("eventId", "status");

ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Ticket transfers ----
ALTER TABLE "Ticket" ADD COLUMN "transferredToEmail" TEXT,
ADD COLUMN "transferredAt" TIMESTAMP(3),
ADD COLUMN "transferredBy" TEXT;

-- ---- Group discounts ----
ALTER TABLE "PromoCode" ADD COLUMN "minQuantity" INTEGER;

-- ---- Staff shift scheduling ----
CREATE TABLE "EventShift" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "role" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventShift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventShift_eventId_idx" ON "EventShift"("eventId");
CREATE INDEX "EventShift_teamMemberId_idx" ON "EventShift"("teamMemberId");

ALTER TABLE "EventShift" ADD CONSTRAINT "EventShift_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventShift" ADD CONSTRAINT "EventShift_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "EventTeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Budget tracking with alerts ----
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "allocatedAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'OMR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Budget_eventId_idx" ON "Budget"("eventId");
CREATE UNIQUE INDEX "Budget_eventId_category_key" ON "Budget"("eventId", "category");

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Sponsor ROI tracking ----
ALTER TABLE "Sponsor" ADD COLUMN "impressions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "clicks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leadsGenerated" INTEGER NOT NULL DEFAULT 0;

-- Note: EventFeedback.npsScore already existed on this DB before this
-- migration (feature #9's schema need was already satisfied) — nothing to
-- add here for it.
