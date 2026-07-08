-- Additive, nullable: organizer_payment ticketing (payment link / transfer
-- details) + the attendee's own "I've paid" claim on a booking.
ALTER TABLE "Event" ADD COLUMN "paymentLinkUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN "transferDetails" TEXT;
ALTER TABLE "Booking" ADD COLUMN "claimedPaidAt" TIMESTAMP(3);
