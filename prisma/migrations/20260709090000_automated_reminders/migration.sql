-- Automated T-N-hours-before reminders: per-event schedule + per-booking
-- dedup tracking so the reminder scan doesn't resend the same offset twice.
ALTER TABLE "Event" ADD COLUMN "reminderSchedule" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Booking" ADD COLUMN "autoRemindersSent" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
