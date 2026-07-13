-- AlterTable
ALTER TABLE "WaitlistEntry" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EventWorkflow" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventWorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "bookingId" TEXT,
    "matchedActions" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventWorkflow_organizerId_idx" ON "EventWorkflow"("organizerId");

-- CreateIndex
CREATE INDEX "EventWorkflow_eventId_idx" ON "EventWorkflow"("eventId");

-- CreateIndex
CREATE INDEX "EventWorkflowRun_workflowId_idx" ON "EventWorkflowRun"("workflowId");

-- AddForeignKey
ALTER TABLE "EventWorkflow" ADD CONSTRAINT "EventWorkflow_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventWorkflow" ADD CONSTRAINT "EventWorkflow_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventWorkflowRun" ADD CONSTRAINT "EventWorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "EventWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FeatureAccess rows for the new "eventWorkflows" flag (free plan: off, pro
-- plan: on — matches every other feature's launch-mode seed, see
-- 20260709110000_ai_studio's migration for the same pattern).
INSERT INTO "FeatureAccess" ("id", "planId", "feature", "enabled")
VALUES
  (gen_random_uuid()::text, 'plan_free', 'eventWorkflows', false),
  (gen_random_uuid()::text, 'plan_pro', 'eventWorkflows', true);
