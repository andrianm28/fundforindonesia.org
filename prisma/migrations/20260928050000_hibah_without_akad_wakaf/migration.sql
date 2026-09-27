-- hibah's checklist does not carry an Akad Wakaf (csr-and-hibah 11, PRD §4).
--
-- The seed that came with prd-12 (PR #68) gave hibah wakaf's three documents
-- verbatim, "Draf akad wakaf" included. That akad is a wakaf document: PRD §4
-- (line 267) says a hibah Campaign has no Akad Wakaf and no ikrar at all, and
-- that any hibah-specific agreement flow is a later review's business (pasal
-- 14). The Akad Wakaf a Platform issues is the same record a hibah Campaign
-- cannot produce, for the same reason a hibah Campaign cannot hold a wakaf
-- Kind Authorisation: a hibah Campaign moves money to a purpose and releases
-- it, it does not bind an asset in perpetuity. PRD §7.1's hibah row already
-- listed two documents — the receiving-entity document and Kind Authorisation
-- `hibah` — and no akad.
--
-- Deactivated, not deleted. The checklist is append-only by design
-- ("nothing is ever deleted", VerificationChecklistAuditEntry references its
-- item with ON DELETE RESTRICT), so a DELETE here would either fail on a row
-- with audit history or silently take that history with it. Deactivating keeps
-- the row, its audit entries, and every Verification Request that was already
-- judged against a snapshot carrying this item: only a submission made from now
-- on is asked for two documents instead of three.
--
-- Scoped as narrowly as the row allows. The seed's own id, its Kind and the
-- label the seed wrote are all required, so the statement can only ever touch
-- the row the seed created: an Admin who has reworded it, moved it to another
-- Kind, or already retired it in the panel is left alone, and the same
-- `Draf akad wakaf` row under `wakaf` — which is the real feature and stays —
-- is never in scope because "kind" is part of the condition. `label`,
-- `position` and `required` are not set: only `active` changes.
--
-- `required` is deliberately not part of the condition. Whether an Admin had
-- made this document optional does not bear on the decision: hibah has no akad
-- to make optional or required, so the row is retired either way. `active`
-- is part of the condition so an already-retired row is left exactly as the
-- Admin left it rather than written to again.
--
-- What this does not settle: whether these two documents are the right two for
-- hibah, and whether the sharia review (ADR 0013, PRD §12, pasal 14) asks for
-- more or different ones. That stays open, and the tests say so where the list
-- is read, so the review's answer lands as a deliberate change.

UPDATE "VerificationChecklistItem"
SET "active" = false
WHERE "id" = 'hibah-draf-akad'
  AND "kind" = 'HIBAH'::"Kind"
  AND "label" = 'Draf akad wakaf'
  AND "active" = true;
