-- Platform expansion: Event Builder 2.0 (drafts/templates), Venue library,
-- advanced ticketing, Attendee CRM, Messaging campaigns, granular staff
-- permissions, Financial expenses, File library, Sponsor/Vendor CRM,
-- post-event feedback, Automation rules, and Organizer goals.
-- All additive/nullable-default — no existing data or query is invalidated.

-- ---- EventVenue (must exist before Event.venueProfileId FK) ----
CREATE TABLE "EventVenue" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "capacity" INTEGER,
    "parkingAvailable" BOOLEAN NOT NULL DEFAULT false,
    "accessibilityNotes" TEXT,
    "indoorOutdoor" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "contacts" JSONB,
    "supplierContacts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventVenue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventVenue_organizerId_idx" ON "EventVenue"("organizerId");
ALTER TABLE "EventVenue" ADD CONSTRAINT "EventVenue_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Event: drafts/templates + venue library link ----
ALTER TABLE "Event" ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "draftData" JSONB;
ALTER TABLE "Event" ADD COLUMN "venueProfileId" TEXT;
CREATE INDEX "Event_venueProfileId_idx" ON "Event"("venueProfileId");
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueProfileId_fkey" FOREIGN KEY ("venueProfileId") REFERENCES "EventVenue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Tier: advanced ticketing ----
ALTER TABLE "Tier" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "Tier" ADD COLUMN "minQty" INTEGER;
ALTER TABLE "Tier" ADD COLUMN "includesMerch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tier" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tier" ADD COLUMN "password" TEXT;
ALTER TABLE "Tier" ADD COLUMN "releaseAt" TIMESTAMP(3);

-- ---- EventTeamMember: granular permissions ----
ALTER TABLE "EventTeamMember" ADD COLUMN "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ---- AttendeeProfile ----
CREATE TABLE "AttendeeProfile" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "birthday" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendeeProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttendeeProfile_organizerId_email_key" ON "AttendeeProfile"("organizerId", "email");
CREATE INDEX "AttendeeProfile_organizerId_idx" ON "AttendeeProfile"("organizerId");
ALTER TABLE "AttendeeProfile" ADD CONSTRAINT "AttendeeProfile_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Campaign ----
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "segment" JSONB,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Campaign_organizerId_idx" ON "Campaign"("organizerId");
CREATE INDEX "Campaign_eventId_idx" ON "Campaign"("eventId");
CREATE INDEX "Campaign_status_scheduledFor_idx" ON "Campaign"("status", "scheduledFor");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Expense ----
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Expense_organizerId_idx" ON "Expense"("organizerId");
CREATE INDEX "Expense_eventId_idx" ON "Expense"("eventId");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- MediaAsset ----
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "folder" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MediaAsset_organizerId_idx" ON "MediaAsset"("organizerId");
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Sponsor ----
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contractUrl" TEXT,
    "logoUrl" TEXT,
    "amount" DOUBLE PRECISION,
    "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'prospect',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Sponsor_organizerId_idx" ON "Sponsor"("organizerId");
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Vendor ----
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contractUrl" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "rating" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Vendor_organizerId_idx" ON "Vendor"("organizerId");
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- EventFeedback ----
CREATE TABLE "EventFeedback" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "bookingId" TEXT,
    "rating" INTEGER,
    "npsScore" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventFeedback_eventId_idx" ON "EventFeedback"("eventId");
ALTER TABLE "EventFeedback" ADD CONSTRAINT "EventFeedback_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- AutomationRule ----
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutomationRule_organizerId_idx" ON "AutomationRule"("organizerId");
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- OrganizerGoal ----
CREATE TABLE "OrganizerGoal" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "revenueGoal" DOUBLE PRECISION,
    "attendanceGoal" INTEGER,
    "eventsGoal" INTEGER,
    "followersGoal" INTEGER,
    CONSTRAINT "OrganizerGoal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizerGoal_organizerId_month_key" ON "OrganizerGoal"("organizerId", "month");
ALTER TABLE "OrganizerGoal" ADD CONSTRAINT "OrganizerGoal_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
