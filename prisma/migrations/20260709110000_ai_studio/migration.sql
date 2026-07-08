-- AI Studio: usage log table + feature-access rows for the new "aiStudio"
-- flag (free plan: off, pro plan: on — matches every other feature's
-- launch-mode "everyone on pro gets it free" seed).
CREATE TABLE "AiGenerationLog" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT,
    "feature" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGenerationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiGenerationLog_organizerId_idx" ON "AiGenerationLog"("organizerId");
CREATE INDEX "AiGenerationLog_eventId_idx" ON "AiGenerationLog"("eventId");

ALTER TABLE "AiGenerationLog" ADD CONSTRAINT "AiGenerationLog_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiGenerationLog" ADD CONSTRAINT "AiGenerationLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FeatureAccess" ("id", "planId", "feature", "enabled")
VALUES
  (gen_random_uuid()::text, 'plan_free', 'aiStudio', false),
  (gen_random_uuid()::text, 'plan_pro', 'aiStudio', true);
