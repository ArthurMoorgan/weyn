-- AgentAction: approval queue for the agentic AI assistant's mutating tool
-- calls. Applied via `prisma db execute` (not `migrate dev`) for the same
-- reason as the two migrations before it — `prisma migrate diff` against
-- the live DB also surfaces unrelated pre-existing drift (dropped Event
-- trgm indexes, a dropped Payment.stripeSessionId column, a
-- VenueApplication.photos default change) that isn't part of this change
-- and is deliberately excluded here.

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentAction_organizerId_idx" ON "AgentAction"("organizerId");

-- CreateIndex
CREATE INDEX "AgentAction_status_idx" ON "AgentAction"("status");

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
