# 11: Hibah's document checklist mirrors Wakaf's

**What to build:** A `hibah` submission is checked against the same document
checklist a `wakaf` submission uses, so verification doesn't silently skip a
step no one has decided to skip.

**Blocked by:** cross-feature `prd-compliance-fase-0-2 12`
(verification-request; its own remaining scope note says per-Kind checklists
are still open, and as of this spec `VerificationChecklistItem` has no
`kind` column at all — the checklist is not per-Kind for any Kind yet)

**Status:** done (PR #86, sha f0182c1)

- [x] `VerificationChecklistItem` (or its replacement) is scoped per Kind,
      built as the general per-Kind mechanism ticket 12 already owes
      `zakat`/`wakaf`, not a `hibah`-only special case
- [x] `hibah`'s checklist starts out identical to `wakaf`'s current checklist
      items
- [x] The Admin checklist editor lets an Admin later diverge `hibah`'s
      checklist from `wakaf`'s without touching `wakaf`'s own items
- [x] A `hibah` Verification Request is checked against `hibah`'s checklist,
      not `wakaf`'s, at submission time (even though the content starts equal)

## Comments

- 2026-09-27 (needs-info resolved): owner chose "lipat ke tiket 12" — the per-Kind checklist mechanism is built in prd-compliance-12 (ready, unblocked); this ticket then seeds hibah's items identical to wakaf's. Do not dispatch before 12 is done.
- 2026-09-27 (FFI-08b): the seed mechanism, the per-Kind `kind` column, and the `submitCampaign` snapshot all landed with prd-12 (PR #68), including three `HIBAH` seed rows. So this ticket did not build a mechanism: it pinned the four promises above at their public seams (submit-time snapshot, Admin editor, the module's commands, and the seed SQL) and corrected one defect the seed carried.
- 2026-09-27 (defect fixed): prd-12's seed gave hibah `Kind Authorisation wakaf`. A hibah Campaign is refused submission unless its Collecting Entity holds a `HIBAH` authorisation (ADR 0013), so that label names a document unrelated to the Campaign being verified. Migration `20260928040000_hibah_kind_authorisation_label` renames the row to `Kind Authorisation hibah`, and only while the label still reads as the seed left it, so an Admin who has already reworded it keeps their wording and audit history.
- 2026-09-27 (placeholder, deliberately): `hibah`'s documents are wakaf's, verbatim, including `Draf akad wakaf` and `Dokumen lembaga nazhir`. FFI-08b and ADR 0013 make that a stated placeholder until it is reviewed against the sharia provisions that apply (pasal 14, PRD §12). It is not a settled list, and the tests say so: changing these expectations is correcting a provisional decision, which the documentation expects rather than treats as a regression.
- 2026-09-27 (open question for the sharia review, not decided here): the PRD's §7.1 table and the seeded rows do not fully agree on `hibah`'s documents. §7.1 lists two — "Dokumen lembaga **penerima**" and Kind Authorisation `hibah` — while the seed carries wakaf's three, so it says "lembaga **nazhir**" and includes `Draf akad wakaf`, and PRD §4 (line 267) says there is no Akad Wakaf for hibah at all ("dokumen dan alur akad khusus untuk hibah menyusul bila ditinjau ulang"). The owner decision of 2026-09-27 (seed `hibah` = `wakaf`) is what the seed implements, so this ticket does not touch the content. The `Kind Authorisation` label is the one thing corrected, because there §7.1 and the code agree. Whether `Draf akad wakaf` and the "nazhir" wording belong on a hibah checklist is a question for the sharia review, not a coding decision; the tests pin the current state so the correction shows up as a deliberate change.
- 2026-09-27 (owner decision, supersedes the two comments above on the akad only): `hibah` needs **no akad document at all**. The question that comment left open is answered, because PRD §4 is explicit rather than implied — "Tidak ada Akad Wakaf maupun ikrar" for `hibah`, with a hibah-specific agreement flow only to "menyusul bila ditinjau ulang" (pasal 14). The Akad Wakaf is a wakaf document: a hibah Campaign transfers money to a purpose and releases it, it does not bind an asset in perpetuity, so asking its Verifier for a wakaf akad draft named a document the Campaign being checked cannot produce — the same defect already corrected for `Kind Authorisation wakaf`. The seed placeholder overreached, and the owner's earlier "seed `hibah` = `wakaf`" reading is narrowed by this. `hibah`'s list is now the two documents §7.1 gives it: dokumen lembaga penerima and Kind Authorisation `hibah`.
- 2026-09-27 (how the removal was bounded): migration `20260928050000_hibah_without_akad_wakaf` deactivates the `hibah-draf-akad` row rather than deleting it, since the checklist is append-only by design and an audit entry references its item with `ON DELETE RESTRICT`. Deactivating also leaves every Verification Request already judged against a snapshot carrying that item alone, and the row keeps its position, label, required flag and audit history in the panel. The `WHERE` names the whole of the seed's row — id, `kind = HIBAH`, the label the seed wrote, and `active` — so a row an Admin has reworded, moved to another Kind, or already retired is left alone, and `wakaf`'s own `Draf akad wakaf` row is never in scope. `required` is deliberately not a condition: an Admin having made the document optional does not bear on the decision, since hibah has no akad to make optional. `wakaf` is untouched throughout — the Akad Wakaf is a real document of a real wakaf flow, and a wakaf submission still asks for it.
- 2026-09-27 (still open, deliberately unchanged): whether **those two** are the right two is *not* decided here. The "lembaga nazhir" wording against §7.1's "lembaga **penerima**" remains open, as does whether a hibah Campaign needs any document beyond them. Both belong to the sharia review (ADR 0013, PRD §12, pasal 14) alongside the rest of the money treatment. The tests say so where the list is read, so the review's answer lands as a deliberate change and not as a regression to be explained.
