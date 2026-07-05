-- Additive, nullable column — kept separate from paytabsTranRef so existing
-- PayTabs rows/logic are untouched.
ALTER TABLE "Payment" ADD COLUMN "stripeSessionId" TEXT;
CREATE UNIQUE INDEX "Payment_stripeSessionId_key" ON "Payment"("stripeSessionId");
