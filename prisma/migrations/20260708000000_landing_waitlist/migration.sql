-- Marketing waitlist for waitlist.weynevents.com — a generic email capture,
-- deliberately unrelated to the existing per-event WaitlistEntry table.
CREATE TABLE "LandingWaitlistSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingWaitlistSignup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LandingWaitlistSignup_email_key" ON "LandingWaitlistSignup"("email");
