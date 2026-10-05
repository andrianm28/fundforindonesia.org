-- Payment sandbox stamp (ticket rilis-1-benda/92): each Payment records whether it
-- was created while the public beta marker (BETA_SANDBOX) was on. Additive, with a
-- default of false: every existing row is a live Payment, which is what it was.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;
