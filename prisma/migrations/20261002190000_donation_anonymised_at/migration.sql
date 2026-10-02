-- Ticket 36 (PRD FFI-16): record when a Donation's Donor had their identity
-- removed. Additive and nullable: every existing row is "not anonymised",
-- which is true of all of them, so nothing is backfilled.
ALTER TABLE "Donation" ADD COLUMN "anonymisedAt" TIMESTAMP(3);
