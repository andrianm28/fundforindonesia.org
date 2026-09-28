# 07: Who may grant an ADMIN or VERIFIER assignment, and is that two-person?

**Type:** grilling

**Status:** resolved

## Question

`Assignment` has exactly two values, `VERIFIER` and `ADMIN`. `UserAssignment`
holds them and `AssignmentAuditEntry` keeps a row for every grant and every
revoke, so the mechanism is complete. The **rule** is not written down
anywhere, and this is the top of the trust chain.

It matters because FFI-07's two-person rule protects money, and the key to
that rule is the assignment itself. If one Admin can grant ADMIN to anyone
with no second person agreeing, then the two-person rule can be routed around
at its source: one grant, and the whole payout chain becomes one person. The
two-person guarantee is only as strong as the grant that made the second
person possible.

`05: What does a person holding two assignments see?` is the same question
from the other side — that one asks what a dual-role person *sees*, this one
asks who can *grant*. They are not the same and both are needed.

Sub-questions:

1. **Does granting ADMIN require a second Admin?** And granting VERIFIER —
   one Admin, or two?
2. **May someone revoke their own assignment?** If the last Admin revokes
   themselves, the platform has no administrator at all, and there is no
   route back in. Refusing it needs a message that says why, or an operator
   will read the refusal as a bug.
3. **May a Verifier administer another Verifier?** Today every Admin screen
   guards on its own assignment, so an Admin-Verifier can both approve a
   Campaign submission and administer the Verifier meant to check it.
4. **Is a grant revocable, and who revokes it?** An audit entry exists for
   every revoke, which implies revocation is expected — but the rule for it is
   the same as the rule for granting.

## Recorded from the intake grilling, 2026-09-27

The owner decided the shape while this map was being charted. It is recorded
here rather than as a resolution, because wayfinder allows one ticket to be
resolved per session and `06` used it.

**Decided:** granting ADMIN takes two Admins; granting VERIFIER takes one.
Nobody may revoke their own assignment, and the refusal must say why.
Admins grant VERIFIER; a Verifier does not.

**Still open, and part of the same ticket:**

- The number. "One bound for zakat and wakaf" from `06` has a number
  question; this has one too — two Admins agreeing is only a real control if
  they cannot be the same person twice, and whether the second Admin may be
  the requester's own supervisor, their peer, or anyone at all is unstated.
- Whether a **pending** grant exists between the two agreements, or the
  second Admin sees a request. An audit trail that only records the finished
  grant cannot show that a second person was asked.
- What happens to the two-person rule when an organisation has exactly one
  Admin. The rule is presumably unsatisfiable, and whether the platform
  refuses the grant or records that it was made by one person is a decision
  with real consequences for a small organisation.
- Whether `AssignmentAuditEntry` needs a reason, the way
  `CampaignStatusChange` does. It records who and when, but not why.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

(a) pending-grant sederhana meniru pola `BankAccountVerificationRequest`
yang baru dibangun tiket 16 — pola sudah ada, tak perlu desain baru; (b)
perbaiki self-revoke agar menolak **kedua** assignment, perbaikan satu baris;
organisasi satu-Admin: grant kedua boleh diajukan sendiri, menunggu Admin
kedua menyetujui, dicatat sebagai kondisi bootstrap bukan jalan pintas permanen;
tambah kolom alasan opsional sekarang, murah, konsisten `CampaignStatusChange`.
