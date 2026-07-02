-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "organizer" TEXT NOT NULL,
    "cat" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "venue" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "capacity" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "image" TEXT,
    "color" TEXT NOT NULL,
    "glyph" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "tags" TEXT[],
    "refundPolicy" TEXT NOT NULL,
    "minAge" INTEGER NOT NULL DEFAULT 0,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "ticketingType" TEXT NOT NULL DEFAULT 'weyn',
    "externalTicketUrl" TEXT,
    "organizerContact" TEXT,
    "sourceUrl" TEXT,
    "importedFromInstagram" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "capacity" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tierId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deviceId" TEXT,
    "email" TEXT,
    "name" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "thawaniSessionId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rawWebhook" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAsset" (
    "eventId" TEXT NOT NULL,
    "instagram" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "telegram" TEXT NOT NULL,
    "twitter" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MarketingAsset_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "Event_organizer_idx" ON "Event"("organizer");

-- CreateIndex
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");

-- CreateIndex
CREATE INDEX "Tier_eventId_idx" ON "Tier"("eventId");

-- CreateIndex
CREATE INDEX "Booking_eventId_idx" ON "Booking"("eventId");

-- CreateIndex
CREATE INDEX "Booking_deviceId_idx" ON "Booking"("deviceId");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_thawaniSessionId_key" ON "Payment"("thawaniSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_deviceId_key" ON "PushToken"("deviceId");

-- AddForeignKey
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "Tier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
