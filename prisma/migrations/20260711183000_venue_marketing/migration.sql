-- Venue Marketing: Campaign.venueId (venue-guest campaigns, alongside the
-- existing event-ticket-buyer eventId), Campaign.recipientCount (historical
-- reach, captured once at send time), VenueGuestNote.tags (real CRM
-- tagging for segment-targeted campaigns). Applied via `prisma db execute`
-- for the same reason as the migrations before it — `prisma migrate diff`
-- against the live DB also surfaces unrelated pre-existing drift (dropped
-- Event trgm indexes, a dropped Payment.stripeSessionId column, a
-- VenueApplication.photos default change) that isn't part of this change.

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "recipientCount" INTEGER,
ADD COLUMN "venueId" TEXT;

-- AlterTable
ALTER TABLE "VenueGuestNote" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Campaign_venueId_idx" ON "Campaign"("venueId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
