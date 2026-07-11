-- Adds Reservation.source (guest vs owner-entered walk-ins) and a
-- per-guest note table for the venue reservation dashboard's guest-history
-- panel. Applied directly via `prisma db execute` (not `migrate dev`)
-- because the production DB already has pre-existing drift from an
-- untracked migration (20260705190000_add_stripe_payment_field) that
-- would otherwise trigger a destructive reset prompt.

ALTER TABLE "Reservation" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'guest';

CREATE TABLE "VenueGuestNote" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueGuestNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VenueGuestNote_venueId_guestEmail_key" ON "VenueGuestNote"("venueId", "guestEmail");

ALTER TABLE "VenueGuestNote" ADD CONSTRAINT "VenueGuestNote_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
