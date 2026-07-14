-- Cancel-flow support columns on Subscription — all additive/nullable, no
-- existing column touched. Backs the new /api/me/subscription/cancel,
-- /pause, and /resume routes (see server/app.js) and the organizer-facing
-- cancel flow (src/components/CancelSubscriptionFlow.tsx). Applied directly
-- via `prisma db execute` + `migrate resolve --applied` rather than
-- `migrate dev`, because this DB (Neon, pooled connection) doesn't permit
-- the shadow-database creation `migrate dev` needs. Deliberately does NOT
-- touch the four migrations already pending-but-unapplied ahead of this one
-- (marketing_hub, venue_marketing_hub, organizer_social_connections,
-- venue_social_connections) — those stay parked exactly as they were.
ALTER TABLE "Subscription" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "cancelFeedback" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "retentionOfferAccepted" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "pausedUntil" TIMESTAMP(3);
