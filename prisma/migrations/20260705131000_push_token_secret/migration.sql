-- Prevent a caller who only knows a deviceId from replacing that device's
-- push token. New registrations store a hash of a per-install secret.
ALTER TABLE "PushToken" ADD COLUMN "secretHash" TEXT;
