-- Paid seat-selection checkout: carries the seat(s) claimed at
-- POST /api/events/:id/checkout time through to the payment webhook, so
-- it can issue the Ticket.seatId row(s) once the booking is actually paid
-- (see server/app.js's POST /api/events/:id/checkout and
-- confirmPaymentFromPayTabs). Applied via `prisma db execute` (not
-- `migrate dev`), same as the other migrations in this directory, to avoid
-- surfacing unrelated pre-existing drift against the live DB.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "seatIds" TEXT[] NOT NULL DEFAULT '{}';
