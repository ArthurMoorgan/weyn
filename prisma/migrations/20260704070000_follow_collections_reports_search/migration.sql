-- CreateTable: Follow
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Collection
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Collection_ownerId_idx" ON "Collection"("ownerId");
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: CollectionItem
CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CollectionItem_collectionId_eventId_key" ON "CollectionItem"("collectionId", "eventId");
CREATE INDEX "CollectionItem_eventId_idx" ON "CollectionItem"("eventId");
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'INAPPROPRIATE', 'FRAUD', 'DUPLICATE', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED');

-- CreateTable: Report
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Report_entityType_entityId_idx" ON "Report"("entityType", "entityId");
CREATE INDEX "Report_status_idx" ON "Report"("status");
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Full-text + fuzzy search support. pg_trgm gives typo-tolerant matching on
-- organizer/venue names. Postgres refuses to_tsvector() directly in a
-- GENERATED column OR an expression index — it's classified STABLE, not
-- IMMUTABLE, because text search configs can technically be altered at
-- runtime. The standard, well-known workaround: wrap it in a SQL function
-- explicitly declared IMMUTABLE (safe here — this app never changes the
-- 'english' config), then index/query through that wrapper instead of
-- calling to_tsvector() directly.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION weyn_event_tsvector(title text, organizer text, venue text, blurb text, tags text[])
RETURNS tsvector AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(organizer, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(venue, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(blurb, '')), 'C') ||
    setweight(to_tsvector('english', array_to_string(tags, ' ')), 'C')
$$ LANGUAGE sql IMMUTABLE;

CREATE INDEX "Event_search_idx" ON "Event" USING GIN (
  weyn_event_tsvector("title", "organizer", "venue", "blurb", "tags")
);
CREATE INDEX "Event_organizer_trgm_idx" ON "Event" USING GIN ("organizer" gin_trgm_ops);
CREATE INDEX "Event_venue_trgm_idx" ON "Event" USING GIN ("venue" gin_trgm_ops);
