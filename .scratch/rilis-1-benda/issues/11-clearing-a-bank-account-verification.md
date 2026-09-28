# 11: What clears a Bank Account's verification, and who may do it?

**Type:** grilling

**Status:** in-review

## Question

[01: How does a Fundraiser get a bank account, and who says it is theirs?](01-bank-account-verification.md)
decided that the account a Payout points at is the thing verified before the
Payout is approved. That was chosen as the compensating control for the one
guarantee the schema cannot give: nothing refuses two Bank Accounts holding the
same number, because the number is a randomized ciphertext that is never
searched (ADR 0012).

A control that can only be applied forwards is not a control. The decisions that
remain:

1. **Who may clear `verifiedAt`?** The same Verifier who set it, a different
   Verifier, an Admin, or nobody. `CONTEXT.md` puts checking a payout account on
   a Verifier, and suspension on an Admin, and this sits between them.
2. **Is it one action or two — refuse future Payouts, or make the account
   unusable?** Clearing `verifiedAt` stops a Payout that has not been approved
   yet and does nothing to a Payout already completed, so a decision here is
   also a decision about what happens to money that already left.
3. **Is it reversible?** If a cleared account can be verified again, the record
   has to say who restored it and why, or a cleared-then-restored account is
   indistinguishable from one that was never cleared.
4. **What triggers it?** Nobody has to notice on their own. Suspicion, a
   complaint, a returned transfer, a Dormant Balance, or a Verifier noticing
   while checking something else — each gives a different queue.

## Notes

Surfaced 2026-09-27 by [01: How does a Fundraiser get a bank account, and who
says it is theirs?](01-bank-account-verification.md), and it is a consequence of
that decision rather than a leftover. `src/lib/money/payouts.ts:246` already
names the idea in a comment — clearing `verifiedAt` "when one turns out to be
fraudulent" — and `payouts.ts:149` and `:250` already refuse an unverified
destination, so the read side works. Only the write is missing.

The two-person rule does not obviously apply, because this removes a
destination rather than paying one, but the same reasoning does: whoever clears
a verification should not be the person who set it, and the person whose account
it is should certainly not be. Whether that is a rule or a preference is part of
question 1.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

(b) Verifier lain — simetris dengan aturan 16 "Verifier tak menilai
rekeningnya sendiri"; dua aksi terpisah (cabut verifikasi ≠ Suspension); yang
sudah cair tidak disentuh; reversibel dengan alasan tercatat, pola yang sama
dengan Flag/Suspension yang sudah ada.

## Implementation

Built on `claude/ticket-11-revoke-bank-verification`. New append-only history
table `BankAccountRevocation` (`action` REVOKED/REINSTATED, `reason`,
`actorId`, `createdAt`), the same shape `CampaignStatusChange` is for
Suspension/lift: `BankAccount.verifiedAt` stays the single "eligible now"
field, this table is only the "why"/"who" of the last change to it. Migration
`20260930080000_bank_account_verification_revocation`.

`revokeBankAccountVerification` / `reinstateBankAccountVerification`
(`src/lib/bank-account-verification.ts`): a Verifier may revoke a verified
account unless they are its owner or the Verifier who most recently approved
it (`RevokerWasApproverError`); a different Verifier than the one who wrote
the account's latest REVOKED row may reinstate it (`ReinstaterWasRevokerError`),
also never the owner. Both require a reason, both write one
`BankAccountRevocation` row and one in-app notification to the owner, and
both use the same conditional `updateMany` guard on `verifiedAt` the existing
decide command uses, so a race throws instead of double-writing.

`payouts.ts` is unchanged, deliberately: `requestPayout`, `approvePayout` and
`completePayout` already re-read `verifiedAt` fresh from the row at each step
(not trusted from an earlier read), so a Payout DRAFT/APPROVED against a
now-revoked account is refused through the existing `BankAccountNotEligibleError`
path with no new check needed. A Payout already COMPLETED is untouched, since
revoke/reinstate never reads or writes `Payout` or the ledger.

UI: `/moderasi/rekening` (`export const dynamic = "force-dynamic"`, since it
reads the DB with no request data) gained two sections below the existing
decide queue — "Rekening Terverifikasi" (revoke, one `RevocationPanel` per
currently-verified account) and "Rekening Dicabut" (reinstate, one panel per
account whose latest revoke/reinstate row is REVOKED). Route:
`POST /api/moderasi/bank-accounts/[id]/revocation` with
`{ action: "revoke" | "reinstate", reason }`, VERIFIER-gated.

Status: in-review.
