-- One claim per LedgerEntry.transactionId (prd-compliance 28b).
--
-- postTransaction used to read for an existing transactionId and write only
-- when it found none. A read-then-write is not a constraint: two callers
-- racing the same id could both read "absent" and both write, and whether a
-- duplicate was stopped at all depended on each caller happening to claim its
-- own row with an updateMany first. That is a property of the callers, not of
-- the ledger, and it stops holding the moment a caller does not.
--
-- Every transaction's legs are numbered here, and leg 0 CLAIMS the
-- transactionId. A partial unique index over the claiming legs is what makes
-- that claim unrepeatable: the index, not a read, refuses the second posting.

-- Before any DDL. Prisma applies a migration in a single transaction, so
-- raising here leaves the table exactly as it was -- and names the ids, since
-- "duplicate key value violates unique constraint" tells an operator nothing
-- about which rows to look at. No ledger row is deleted to make this apply: a
-- transactionId posted twice is a fact about money that has already moved,
-- and which of the two sets is the real one is not this migration's to guess.
DO $$
DECLARE
  duplicate_count BIGINT;
  offenders TEXT;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT "transactionId"
    FROM "LedgerEntry"
    GROUP BY "transactionId"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  SELECT string_agg("transactionId", ', ') INTO offenders
  FROM (
    SELECT "transactionId"
    FROM "LedgerEntry"
    GROUP BY "transactionId"
    HAVING COUNT(*) > 1
    ORDER BY "transactionId"
    LIMIT 20
  ) AS some_offenders;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'LedgerEntry already holds % transactionId(s) posted more than once, e.g. %; this migration applies nothing. Settle which set of entries is the real one, then migrate.',
      duplicate_count,
      offenders;
  END IF;
END $$;

-- AlterTable: the position of an entry inside its transaction. Required,
-- because "which leg am I" is now the question the uniqueness of a
-- transactionId is built on, not a nicety of ordering.
ALTER TABLE "LedgerEntry" ADD COLUMN "legIndex" INTEGER;

-- Number the legs of every transaction that already exists, oldest first. This
-- is what keeps the index honest for history: without it the rows posted
-- before this migration would hold no claim at all, and re-posting one of
-- their transactionIds would be free.
UPDATE "LedgerEntry" AS entry
SET "legIndex" = numbered."legIndex"
FROM (
  SELECT id, (row_number() OVER (PARTITION BY "transactionId" ORDER BY "createdAt", id) - 1)::int AS "legIndex"
  FROM "LedgerEntry"
) AS numbered
WHERE entry.id = numbered.id;

ALTER TABLE "LedgerEntry" ALTER COLUMN "legIndex" SET NOT NULL;

-- CreateIndex: a transactionId is claimed by exactly one entry, ever. Partial
-- on "legIndex" = 0, so the other legs of a transaction are unaffected -- this
-- is one unique claim per transaction, not one entry per transaction. Postgres
-- checks a unique index per statement and does not defer, so of two callers
-- posting the same transactionId concurrently the loser's INSERT fails
-- immediately, and takes its whole multi-row statement down with it: the loser
-- posts nothing rather than half a transaction.
CREATE UNIQUE INDEX "LedgerEntry_transactionId_claim_key" ON "LedgerEntry"("transactionId") WHERE "legIndex" = 0;
