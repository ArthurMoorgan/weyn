-- Promotion Center: UTM attribution on bookings
ALTER TABLE "Booking" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "Booking" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "Booking" ADD COLUMN "utmCampaign" TEXT;
