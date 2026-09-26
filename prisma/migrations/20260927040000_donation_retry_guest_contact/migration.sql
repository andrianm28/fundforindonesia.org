-- Retryable donations, frozen Escrow Hold duration, and Guest Donor contact
-- details (prd-compliance 18; CONTEXT.md, Guest Donor, Escrow Hold).

-- DropIndex: Payment.donationId is no longer unique -- a retry after
-- FAILED/EXPIRED creates a NEW Payment on the SAME Donation, so the history
-- of attempts survives instead of one Payment being mutated in place.
DROP INDEX "Payment_donationId_key";

-- CreateIndex: cheap lookup of a Donation's Payments in creation order, to
-- find its latest attempt and decide whether a retry is allowed.
CREATE INDEX "Payment_donationId_status_idx" ON "Payment"("donationId", "status");

-- CreateIndex: the database's own guarantee that at most one Payment per
-- Donation ever reaches PAID. Partial on status = 'PAID' so PENDING/FAILED/
-- EXPIRED rows for the same Donation never conflict with each other or with
-- this constraint -- only a second PAID row for the same donationId does.
-- This is what closes the race the app-level `status: PENDING` guard in the
-- webhook cannot: two distinct webhook deliveries settling two DIFFERENT
-- Payment rows of the same Donation at once. Postgres checks a unique index
-- per statement, not deferred, so the loser's UPDATE fails immediately
-- inside its own transaction rather than silently double-crediting the
-- campaign.
CREATE UNIQUE INDEX "Payment_donationId_paid_key" ON "Payment"("donationId") WHERE "status" = 'PAID';

-- AlterTable: the Escrow Hold length frozen at Payment creation.
ALTER TABLE "Payment" ADD COLUMN "escrowHoldDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable: Guest Donor contact details (CONTEXT.md, Guest Donor). No
-- backfill -- these columns are new, no existing Donation ever collected
-- this data.
ALTER TABLE "Donation" ADD COLUMN "guestEmail" TEXT;
ALTER TABLE "Donation" ADD COLUMN "guestName" TEXT;
ALTER TABLE "Donation" ADD COLUMN "guestPhone" TEXT;
ALTER TABLE "Donation" ADD COLUMN "guestEmailHmac" TEXT;
ALTER TABLE "Donation" ADD COLUMN "guestEmailHmacKeyId" TEXT;
ALTER TABLE "Donation" ADD COLUMN "guestEmailCiphertext" TEXT;
ALTER TABLE "Donation" ADD COLUMN "guestEmailKeyId" TEXT;
ALTER TABLE "Donation" ADD COLUMN "guestPhoneCiphertext" TEXT;
ALTER TABLE "Donation" ADD COLUMN "guestPhoneKeyId" TEXT;

-- CreateIndex
CREATE INDEX "Donation_guestEmailHmac_idx" ON "Donation"("guestEmailHmac");
