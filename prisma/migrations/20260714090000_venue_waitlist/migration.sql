-- Venue reservation waitlist — new, standalone additive table. Applied
-- directly via `prisma db execute` + `migrate resolve --applied`, same as
-- 20260714080000_subscription_cancel_flow, because this DB (Neon, pooled
-- connection) doesn't permit the shadow-database creation `migrate dev`
-- needs. Deliberately does NOT touch the four migrations already
-- pending-but-unapplied ahead of this one (marketing_hub,
-- venue_marketing_hub, organizer_social_connections,
-- venue_social_connections) — those stay parked exactly as they were.

CREATE TYPE "VenueWaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'CONVERTED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "VenueWaitlistEntry" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "guestPhone" TEXT,
    "partySize" INTEGER NOT NULL,
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "requestedTimeWindow" TEXT NOT NULL,
    "notes" TEXT,
    "status" "VenueWaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "convertedReservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueWaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VenueWaitlistEntry_venueId_idx" ON "VenueWaitlistEntry"("venueId");
CREATE INDEX "VenueWaitlistEntry_venueId_status_idx" ON "VenueWaitlistEntry"("venueId", "status");
CREATE INDEX "VenueWaitlistEntry_requestedDate_idx" ON "VenueWaitlistEntry"("requestedDate");

ALTER TABLE "VenueWaitlistEntry" ADD CONSTRAINT "VenueWaitlistEntry_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
