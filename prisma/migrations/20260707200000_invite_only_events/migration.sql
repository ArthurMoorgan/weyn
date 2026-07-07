-- Invite-only hosting: an event can be marked inviteOnly, generating a
-- secret inviteCode. Such an event never appears in public Discovery and
-- can't be booked without a matching code — only reachable via a direct
-- link the organizer shares.
ALTER TABLE "Event" ADD COLUMN "inviteOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "inviteCode" TEXT;
CREATE UNIQUE INDEX "Event_inviteCode_key" ON "Event"("inviteCode");
