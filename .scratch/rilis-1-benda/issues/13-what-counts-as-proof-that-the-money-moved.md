# 13: What counts as proof that the money actually moved?

**Type:** grilling

**Status:** open

**Blocked by:** 03

## Question

The last step of the money-out path is a string. `proofImage` is
`z.string().trim().min(1)` in
`src/app/api/campaigns/[slug]/payouts/[id]/complete/route.ts:11` (and the same
line in the Volunteer Trip twin), and `completePayout` re-checks only
`proofImage.trim() === ''` at `src/lib/money/payouts.ts:426`. So
`{"proofImage": "x"}` closes a Payout: the legs post, `PAYOUT_CLEARING`
drains, `completedAt` is written, and the reconciliation stops listing it as
outstanding.

The two-person rule is fully satisfied doing that. One Admin approves, a
different Admin completes, and nobody transfers anything. FFI-07's promise --
"selalu ada dua orang berbeda di sisi operator pada setiap rupiah yang keluar" --
is about two pairs of hands, and two hands with nothing in them still satisfy
it. `docs/integrasi-sumopod.md:69` goes further and calls the two-person rule
and the mandatory proof "the only control" this flow has. There is no second
control. If the proof is one typed character, the flow has none.

**The repo never says what "bukti transfer" is.** FFI-07, `CONTEXT.md:225` and
`docs/PRD-fund-for-indonesia.md:182` (§7.2, *Siklus status* — "Admin menandai
selesai dengan bukti transfer. Tanpa bukti, tidak bisa selesai") all use the
phrase and none defines it -- upload, or a note. Three questions that have to
be answered together:

1. **Is the proof an artefact or a note?** FFI-07 says a future provider with a
   disbursement API would replace it with "referensi penyedia" -- which only
   makes sense if today it is something the provider does *not* supply, i.e. an
   artefact the Admin attaches. But nothing in the schema, the routes or
   `docs/` requires a file, and the one upload endpoint in the repo
   (`src/app/api/upload/route.ts`) writes into `public/uploads` and serves from
   there with no access control, so making proof-of-transfer an upload means
   inheriting that trap. [03: Where do submitted documents live, and who may
   see one?](03-documents.md) owns where documents live; it does not own
   whether a Payout may be closed without one.
2. **How much does one have to say?** "x" passes today. A provider reference, a
   transfer timestamp, an amount, a destination-account last-four, a free
   sentence -- each is a different amount of evidence, and each is checkable by
   a human reading the Payout later. Nothing today records *what* was checked,
   only *that* a string was present.
3. **The same requirement is enforced two different ways.** `ManualContribution`
   takes `proofReference String @db.VarChar(500)`, required, with the route
   comment saying "no provider confirms this money, so the evidence is the only
   thing standing behind the number" (`src/app/api/admin/manual-contributions/route.ts:17`).
   FFI-07c (`docs/PRD-fund-for-indonesia.md:127`) demands "bukti transfer wajib;
   aturan dua orang seperti Payout" -- the same rule, the same reasoning. Yet
   `Payout.proofImage` is `String?` with no length and no format
   (`prisma/schema.prisma:1631` vs `:1571`).

   The asymmetry is not only in the columns. `ManualContribution` validates its
   evidence in the service layer -- `cleanProofReference`
   (`src/lib/money/manual-contributions.ts:212-223`) rejects empty, trims, and
   refuses over `MAX_PROOF_REFERENCE_LENGTH`. `Payout` has no equivalent: the
   only check is `proofImage.trim() === ''` at `payouts.ts:426`. So one of the
   two paths has a rule written down in one place and the other has a
   tautology. Decide one shape and apply it to both, or say why a Payout's
   evidence is allowed to be weaker than a Manual Contribution's when both are
   hand-typed by one person about money no provider confirmed.

## Notes

Surfaced 2026-09-28 by a read-only pass over the completion route, then verified
against the code: both `complete` routes carry the identical `min(1)` schema,
`payouts.ts:426` is the only other check, and `payouts.test.ts:445` tests only
`''` and `'   '`. `DisbursementLegacy` (`prisma/schema.prisma:1753`) has a
`proofImage` column too and is read-only -- nothing writes it, so it is not
part of this.

The two-person rule itself is sound and is not what is in question here.
`completePayout` refuses the approver, refuses the Campaign's own Fundraiser,
re-checks the Bank Account's `verifiedAt` and takes the Campaign row lock. What
is missing is the other half of FFI-07's sentence, not the half that is built.

Not a duplicate of [12: Where is a Bank Account number decrypted, and what is
the payout instruction?](12-decrypting-a-bank-account-at-payout.md): that asks
whether the account number needs to be readable at payout time at all. This
asks what the second Admin leaves behind when they come back. If the answer to
12 turns out to be "the number never reaches the platform, the transfer is made
in the provider dashboard by hand", that makes proof-of-transfer *more*
important here, not less -- the platform's only trace of the transfer is the
string.
