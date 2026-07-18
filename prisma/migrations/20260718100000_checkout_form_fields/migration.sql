-- Custom booking-form builder: organizer-defined extra fields collected at
-- booking/checkout time (Event.checkoutFormFields) and the buyer's answers
-- (Booking.customFieldValues). Applied via `prisma db execute` (not
-- `migrate dev`), same as the other migrations in this directory, to avoid
-- surfacing unrelated pre-existing drift against the live DB.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "checkoutFormFields" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "customFieldValues" JSONB NOT NULL DEFAULT '{}';
