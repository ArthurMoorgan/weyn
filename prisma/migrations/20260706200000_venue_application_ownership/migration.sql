-- Additive: full listing data + ownership-proof + admin review trail on
-- venue applications, so an approved application mints a complete Venue and
-- ownership is verified by a human before anything goes live.
ALTER TABLE "VenueApplication"
  ADD COLUMN "venue"            TEXT,
  ADD COLUMN "lat"              DOUBLE PRECISION,
  ADD COLUMN "lng"              DOUBLE PRECISION,
  ADD COLUMN "coverImage"       TEXT,
  ADD COLUMN "photos"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "role"             TEXT,
  ADD COLUMN "businessRegNo"    TEXT,
  ADD COLUMN "proofDocUrl"      TEXT,
  ADD COLUMN "reviewedBy"       TEXT,
  ADD COLUMN "reviewedAt"       TIMESTAMP(3),
  ADD COLUMN "reviewNote"       TEXT,
  ADD COLUMN "resultingVenueId" TEXT;
