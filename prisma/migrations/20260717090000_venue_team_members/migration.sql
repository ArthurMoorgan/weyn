-- CreateTable
CREATE TABLE "VenueTeamMember" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "invitedEmail" TEXT NOT NULL,
    "userId" TEXT,
    "role" "TeamRole" NOT NULL,
    "status" "TeamInviteStatus" NOT NULL DEFAULT 'PENDING',
    "inviteToken" TEXT,
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "VenueTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VenueTeamMember_inviteToken_key" ON "VenueTeamMember"("inviteToken");

-- CreateIndex
CREATE INDEX "VenueTeamMember_venueId_idx" ON "VenueTeamMember"("venueId");

-- CreateIndex
CREATE INDEX "VenueTeamMember_userId_idx" ON "VenueTeamMember"("userId");

-- CreateIndex
CREATE INDEX "VenueTeamMember_invitedEmail_idx" ON "VenueTeamMember"("invitedEmail");

-- AddForeignKey
ALTER TABLE "VenueTeamMember" ADD CONSTRAINT "VenueTeamMember_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueTeamMember" ADD CONSTRAINT "VenueTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueTeamMember" ADD CONSTRAINT "VenueTeamMember_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
