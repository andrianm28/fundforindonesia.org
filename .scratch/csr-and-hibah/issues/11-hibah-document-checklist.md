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
