# 20: The two-person ADMIN grant, implemented

**Type:** implementation

**Status:** done (PR #125, c4620ae)

**Blocked by:** nothing — `07` is `resolved` and this ticket is the code for it

## What this is

The code for `07`'s answer
([07-granting-assignments.md](07-granting-assignments.md)), recorded
2026-09-28: granting ADMIN takes two Admins (one proposes, a DIFFERENT Admin
confirms; neither the proposer nor the grantee may confirm their own
proposal); granting VERIFIER stays a single Admin's immediate grant; nobody
may revoke their own assignment, of either kind (the known gap — only ADMIN
self-revoke was refused before this ticket); every step is audited in
`AssignmentAuditEntry`, now with an optional `reason`.

New: `AssignmentGrantRequest` (migration
`20260930040000_assignment_grant_requests`), mirroring
`BankAccountVerificationRequest` (ticket 16) — a partial unique index keeps
at most one PENDING request per grantee, and the confirm/withdraw writes are
conditional `updateMany`s so a request cannot be decided twice under a race.
Service layer: `src/lib/assignments.ts`. Routes:
`src/app/api/admin/users/[id]/assignments/route.ts` (POST now proposes
ADMIN instead of granting it outright) and
`src/app/api/admin/assignment-grant-requests/[requestId]/decision/route.ts`
(confirm/withdraw), plus a GET queue at
`src/app/api/admin/assignment-grant-requests/route.ts`. Minimal UI wired
into the existing `src/app/admin/users/page.tsx` screen: checking Admin for
someone else opens a pending request instead of granting it, shown with
"(menunggu konfirmasi)"; a small queue above the table lets a different
Admin confirm, or lets the proposer withdraw their own.

## Left open by 07, decided here as the smallest honest option

- **Expiry of a pending grant:** none. A PENDING request waits indefinitely,
  the same choice `BankAccountVerificationRequest` already makes; only its
  own proposer can withdraw it.
- **What the UI shows:** the pending state on the checkbox, and a queue of
  every PENDING request with a Confirm button (for anyone but the proposer
  or grantee) or a Withdraw button (for the proposer only). No separate
  admin-grant screen was built beyond that.

## Comments

- 2026-10-02: done. Merged di PR #125 (c4620ae). Status sebelumnya `in-review` (label tidak sah); dikoreksi koordinator.
