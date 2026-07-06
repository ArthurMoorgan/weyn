-- Venue reservation-hosting applications, reviewed manually by the Weyn
-- team (see POST /api/venue-applications). Purely additive.
CREATE TABLE "VenueApplication" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT,
    "businessType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "description" TEXT,
    "area" TEXT,
    "guestTags" TEXT[],
    "priceRange" TEXT,
    "subscriptionTier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VenueApplication_status_idx" ON "VenueApplication"("status");
CREATE INDEX "VenueApplication_applicantId_idx" ON "VenueApplication"("applicantId");

ALTER TABLE "VenueApplication" ADD CONSTRAINT "VenueApplication_applicantId_fkey"
  FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
