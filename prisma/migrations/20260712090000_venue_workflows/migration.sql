-- VenueOS Workflows: AutomationRule.venueId, alongside the existing
-- event-scoped automation rules. Applied via `prisma db execute` for the
-- same reason as every migration before it this session — `prisma migrate
-- diff` against the live DB also surfaces unrelated pre-existing drift
-- (dropped Event trgm indexes, a dropped Payment.stripeSessionId column, a
-- VenueApplication.photos default change) that isn't part of this change.

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN "venueId" TEXT;

-- CreateIndex
CREATE INDEX "AutomationRule_venueId_idx" ON "AutomationRule"("venueId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
