-- Provider settlement estimate anchors the Escrow Hold, not server receipt
-- time (prd-compliance 19; docs/integrasi-sumopod.md, "Waktu dan Escrow").

-- AlterTable: settledAt is new and has nothing to backfill -- no existing
-- Payment ever recorded a provider settlement estimate separately from
-- paidAt, so every row starts NULL like any other Payment created before
-- this column existed.
ALTER TABLE "Payment" ADD COLUMN "settledAt" TIMESTAMP(3);
