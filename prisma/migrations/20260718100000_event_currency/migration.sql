-- Display-only currency label for Event.price/tier/fee amounts (see
-- src/pages/EventDetail.tsx, Checkout.tsx, Search.tsx, Explore.tsx, and
-- organizer-side price displays). No conversion/FX logic anywhere — the
-- underlying stored amounts are unaffected. Applied via `prisma db execute`
-- (not `migrate dev`), same as the other migrations in this directory, to
-- avoid surfacing unrelated pre-existing drift against the live DB.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'OMR';
