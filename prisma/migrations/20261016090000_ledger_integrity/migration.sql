-- Ledger integrity (audit data D1 + D5, payments PAY-12).
--
-- 1. D5: index the three FK columns the public impact queries and the
--    reconcile report filter on (impact.ts groupBy paymentId / refundId /
--    payoutId). Postgres does not index an FK column by itself, so each of
--    those queries scanned the whole ledger. On a very large production table
--    run these as CREATE INDEX CONCURRENTLY by hand first; IF NOT EXISTS makes
--    this migration a no-op for them afterwards.
--
-- Rollback (by hand, if ever needed): DROP TRIGGER "LedgerEntry_append_only"
-- ON "LedgerEntry"; DROP FUNCTION "LedgerEntry_reject_change"(); ALTER TABLE
-- "LedgerEntry" DROP CONSTRAINT "LedgerEntry_amount_positive"; then re-add the
-- seven FKs with ON DELETE SET NULL. The indexes can stay.
--
-- `prisma migrate deploy` adds no transaction, so the FK swap and the rest run
-- inside one here: a failure part-way leaves the table as it was.
CREATE INDEX IF NOT EXISTS "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");
CREATE INDEX IF NOT EXISTS "LedgerEntry_refundId_idx" ON "LedgerEntry"("refundId");
CREATE INDEX IF NOT EXISTS "LedgerEntry_payoutId_idx" ON "LedgerEntry"("payoutId");

-- 2. D1: every LedgerEntry foreign key becomes ON DELETE RESTRICT.
--    SET NULL is an UPDATE: deleting a Payment, Refund, Payout or Campaign
--    would silently detach its legs and the append-only trigger below would
--    have to carve out an exception for it. No application code deletes any
--    of these parents (ADR 0016), so refusing the delete is the right answer.
BEGIN;

ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_campaignId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_paymentId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_refundId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_payoutId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_manualContributionId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_manualContributionId_fkey" FOREIGN KEY ("manualContributionId") REFERENCES "ManualContribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_campaignTransferId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_campaignTransferId_fkey" FOREIGN KEY ("campaignTransferId") REFERENCES "CampaignTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_providerWithdrawalId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_providerWithdrawalId_fkey" FOREIGN KEY ("providerWithdrawalId") REFERENCES "ProviderWithdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. D1 / PAY-12: the ledger is append-only. Nothing in src/ updates or
--    deletes a LedgerEntry row (checked: no ledgerEntry.update/updateMany/
--    delete/deleteMany outside one test helper), so the trigger carves out
--    nothing. TRUNCATE does not fire row triggers and is deliberately left
--    alone for test databases. A future migration that must correct ledger
--    rows (as 20260928040000 once did) disables this trigger for its own
--    statements and re-enables it before it ends.
CREATE OR REPLACE FUNCTION "LedgerEntry_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only: % is not allowed (post a reversing journal instead)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "LedgerEntry_reject_change"();

-- 4. Direction carries the sign, so an amount is always positive:
--    assertBalanced in src/lib/money/ledger.ts rejects amount <= 0 before any
--    row is written, and postTransaction is the only writer. Not added:
--    CHECKs on Payment/Refund/Payout/ManualContribution amounts and
--    Payment donationId XOR registrationId (not verified against every writer
--    and legacy rows here).
--    NOT VALID: every new row is checked, but rows written before this
--    migration are not scanned, so a legacy row (history before 2026-10-03 is
--    squashed and could not be audited) cannot fail the deploy. Once
--    `SELECT count(*) FROM "LedgerEntry" WHERE amount <= 0` is 0 in
--    production, `ALTER TABLE "LedgerEntry" VALIDATE CONSTRAINT
--    "LedgerEntry_amount_positive";` makes it cover the old rows too.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amount" > 0) NOT VALID;

COMMIT;
