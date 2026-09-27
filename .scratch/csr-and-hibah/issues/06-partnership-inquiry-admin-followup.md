# 06: Partnership Inquiry follow-up by the partnership team

**What to build:** A member of the partnership team can see and update a
Partnership Inquiry's follow-up status.

**Blocked by:** 05

**Status:** done (PR #84, sha 363ce4e)

- [ ] `PATCH /api/admin/partnership-inquiries/[id]` moves the follow-up status
      forward (e.g. not-yet-followed-up → in-progress → done), Admin/partnership
      team only
- [ ] A list view shows every Partnership Inquiry with its Program, company
      name, and current status
- [ ] Every status change records who and when

## Comments

- 2026-09-27 (audit trail: yes, who and when, no reason). The status change
  goes to an append-only `PartnershipInquiryStatusChange` row written in the
  same transaction as the move: who, from which status to which, and when,
  with `onDelete: Restrict` on both relations like `CampaignStatusChange` --
  deleting an Inquiry or a person must never erase a follow-up. It carries no
  `reason`, and that is a decision rather than an omission: a Campaign's status
  change changes what a Donor may give, so its log explains itself to a third
  party, while a follow-up changes only the partnership team's own queue and
  refuses nobody. Adding a reason later is additive. The queue shows the last
  step and who took it, so the answer is on the screen and not in a log nobody
  reads.

- 2026-09-27 (why this is not the campaign lifecycle runner).
  `src/lib/campaign-lifecycle.ts` stays the only writer of a Campaign status,
  and its `runCommand` is deliberately about a Campaign: a subject-guard row
  lock, the Capacity judgement against a Fundraiser who owns the subject, the
  acting Capacity, the leave-Active side effects, and a notice to the
  Fundraiser. A Partnership Inquiry has none of that -- no owner, no Fundraiser,
  no Capacity beyond the ADMIN assignment the route already checked, no
  deadline to be effectively past, no Donation to stop accepting, and no money
  at all (ADR 0002). Widening the runner would put a CSR work queue inside the
  money lifecycle's lock order and notification machinery for no gain, so this
  ticket copies the part of the pattern that is about safety instead: the
  single **predicated** write (`updateMany` on `WHERE id = ? AND status = ?`),
  the log row in the same transaction, and one typed refusal per refusal. The
  predicate is what makes two admins moving one Inquiry at once end with one
  move and one 409 rather than one overwrite; a test drives that race. No row
  lock is taken, and `subject-lock-single-owner.test.ts` still holds: the guard
  is the only code locking a Campaign or a Trip, and this locks neither.

- 2026-09-27 ("partnership team" means the ADMIN assignment, as it does for
  the Program catalog of ticket 01). No `PARTNERSHIP` assignment was invented:
  the `Assignment` enum is a fixed pair decided with ADR 0005, and a new one
  is a decision for the owner, not a side effect of a follow-up queue. Both
  routes go through `withAssignmentCheck(Assignment.ADMIN, ...)` and both are
  listed in `roles-expand-guard.test.ts`, which pins that exactly those files
  decide access by assignment.

- 2026-09-27 (forward only, and DONE is final). `nextInquiryStatus` offers the
  one step forward and nothing else: a status the Inquiry already holds, one
  behind it, and one past DONE are all refused, and no log row is written when
  they are. There is no reopen, because nothing in CONTEXT.md or the PRD asks
  for one and a done conversation that can look new again is worse than one
  that cannot.

- 2026-09-27 (two pinned tests moved, both deliberately). Ticket 05's
  `program-money-isolation.test.ts` asserted the Inquiry had "exactly one
  relation"; the follow-up log is a second, relation-shaped field, and the
  assertion now reads as the one `@relation` it always was (the Program) plus
  the log, with the money assertions unchanged and a new block pinning that the
  log itself reaches no money model and loses nothing to a delete.
  `roles-expand-guard.test.ts` grew by two routes, as ticket 01 and prd-14 did.

- 2026-09-27 (the follow-up vocabulary moved to its own leaf module).
  `src/lib/partnership-inquiry-status.ts` now holds the statuses, the initial
  status, the Indonesian labels and the one step forward;
  `partnership-inquiries.ts` re-exports them, so ticket 05's seam and its tests
  are untouched. The reason is the browser bundle: `partnership-inquiries.ts`
  reaches the Mailer and the Mailer reaches nodemailer, so the Admin page
  cannot import it.

- 2026-09-27 (known gap, not fixed here): the notification email of PR #71
  links to `/admin/partnership-inquiries/{id}`, and this ticket builds the
  queue at `/admin/partnership-inquiries` only, so that per-Inquiry link still
  404s. The ticket asks for a list view, and a detail page plus a single-Inquiry
  read is a separate ticket -- worth writing, since the same email is the only
  place the partnership team is told an Inquiry exists.
