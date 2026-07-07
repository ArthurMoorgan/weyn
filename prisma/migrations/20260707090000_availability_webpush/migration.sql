-- Additive: venue applications persist the availability schedule the
-- applicant enters at Step 6 (previously collected in the UI and silently
-- discarded), and push notifications gain a user link so approval/booking
-- pushes can target a person, not just a device.
ALTER TABLE "VenueApplication" ADD COLUMN "availability" JSONB;

-- Web Push (VAPID) subscriptions — browser/PWA push, the only channel that
-- reaches current users (APNs tokens in PushToken are native-app only).
CREATE TABLE "WebPushSubscription" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "endpoint"  TEXT NOT NULL,
  "p256dh"    TEXT NOT NULL,
  "auth"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebPushSubscription_endpoint_key" ON "WebPushSubscription"("endpoint");
CREATE INDEX "WebPushSubscription_userId_idx" ON "WebPushSubscription"("userId");
ALTER TABLE "WebPushSubscription" ADD CONSTRAINT "WebPushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Optional user link for native APNs tokens too (registered pre-Clerk sign-in
-- tokens keep userId NULL).
ALTER TABLE "PushToken" ADD COLUMN "userId" TEXT;
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");
