ALTER TABLE "Payment" RENAME COLUMN "thawaniSessionId" TO "paytabsTranRef";
ALTER INDEX "Payment_thawaniSessionId_key" RENAME TO "Payment_paytabsTranRef_key";
