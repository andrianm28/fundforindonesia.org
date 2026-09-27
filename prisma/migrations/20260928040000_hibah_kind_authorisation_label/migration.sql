-- The hibah checklist's Kind Authorisation item named "wakaf" (csr-and-hibah
-- 11, PRD FFI-08b). hibah carries its own row per wakaf document so the two
-- lists can be diverged from the panel later, but the authorisation it asks a
-- hibah Campaign's Verifier for has to be the hibah one: ADR 0013 requires a
-- Kind Authorisation for `hibah`, granted by a Verifier, and a hibah Campaign
-- is refused submission without it, so asking for a wakaf authorisation names
-- a document the Campaign being checked cannot produce. The PRD's own §7.1
-- table already says "Kind Authorisation `hibah`" for this Kind.
--
-- Which documents hibah needs at all stays a placeholder (ADR 0013, PRD §12,
-- pasal 14): hibah ships with wakaf's documents until they are reviewed
-- against the sharia provisions that apply. This statement renames one row, it
-- does not settle that question.
--
-- The label is only corrected while it still reads as the seed left it, so an
-- Admin who has already reworded this row in the panel keeps their wording and
-- their audit history. No position, required flag, or other row is touched.

UPDATE "VerificationChecklistItem"
SET "label" = 'Kind Authorisation hibah'
WHERE "id" = 'hibah-kind-authorisation' AND "label" = 'Kind Authorisation wakaf';
