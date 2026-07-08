-- Additive, nullable: prefill defaults for new events, per organizer.
ALTER TABLE "User" ADD COLUMN "defaultEventSettings" JSONB;
