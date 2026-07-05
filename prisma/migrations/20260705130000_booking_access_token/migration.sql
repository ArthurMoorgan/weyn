-- Protect ticket QR-code lookup with a second unguessable secret separate
-- from the booking id. Existing rows stay nullable so old bookings do not
-- break; new bookings are created with accessToken in server/db.js.
ALTER TABLE "Booking" ADD COLUMN "accessToken" TEXT;

CREATE UNIQUE INDEX "Booking_accessToken_key" ON "Booking"("accessToken");
