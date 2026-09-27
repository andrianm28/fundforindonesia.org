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

-- There is deliberately NO precheck here, and the reason is worth recording
-- because an earlier draft of this file had one.
--
-- The obvious precheck -- "does any transactionId already have more than one
-- row?" -- cannot work, because every transaction has at least two legs by
-- construction: assertLegsValid (src/lib/money/ledger.ts) rejects a
-- single-leg set, so a healthy ledger is one where that count is NEVER 1.
-- Such a check refuses to apply to every database holding a single posted
-- transaction, which is every real one. ci/local.sh would not have caught
-- that, because it migrates an empty database.
--
-- A precheck that counts something else does not become sound for free: before
-- this migration a row carries no posting identity at all. "This
-- transactionId was posted twice" and "one posting of a transaction that
-- happens to have twice the legs" produce the exact same table -- the same
-- transactionId, the same pairs of legs, the same sums -- and only a marker
-- distinguishing one posting from the next could tell them apart, and there is
-- none to read. So no statement in this file can decide that question, and a
-- check that claimed to would be guessing about money that has already moved.
--
-- What IS decidable is the claim itself, and it is decided below rather than
-- before: the backfill numbers the legs partitioned BY transactionId, so every
-- transactionId that exists ends with exactly one leg 0 by construction, and
-- the index the last statement creates therefore cannot fail to be built. The
-- index is the check; it just has nothing left to catch.
--
-- Prisma does NOT wrap a PostgreSQL migration file in a transaction -- there
-- is no BEGIN/COMMIT here and `prisma migrate deploy` does not add one -- so a
-- failure part-way through would leave the earlier statements applied and this
-- migration unrecorded. Every statement is therefore written to be re-runnable
-- (IF NOT EXISTS, and a backfill that re-derives the same numbers from the
-- same rows), and the ordering is the one that matters: column, then backfill,
-- then NOT NULL, then the index, each of which depends only on the one above
-- it having completed. A re-run after a partial application is a no-op.

-- AlterTable: the position of an entry inside its transaction. Required,
-- because "which leg am I" is now the question the uniqueness of a
-- transactionId is built on, not a nicety of ordering.
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "legIndex" INTEGER;

-- Number the legs of every transaction that already exists, oldest first. This
-- is what keeps the index honest for history: without it the rows posted
-- before this migration would hold no claim at all, and re-posting one of
-- their transactionIds would be free. Partitioned by transactionId, so each one
-- gets exactly one 0; ordered by (createdAt, id) so a re-run reproduces the
-- same numbers rather than reshuffling them.
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
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_transactionId_claim_key" ON "LedgerEntry"("transactionId") WHERE "legIndex" = 0;
