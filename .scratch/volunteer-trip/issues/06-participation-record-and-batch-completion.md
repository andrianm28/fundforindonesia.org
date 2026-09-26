# 06: Volunteer's participation record and Batch completion

**What to build:** A Volunteer can see their own registration history on their dashboard, the same way they already see their Donation history. A Fundraiser (or Admin) can mark a Batch as completed once it's happened, and a completed, confirmed Registration shows as a visible record of participation. A full generated certificate artifact (PDF or similar) is deliberately not built here — the spec this ticket comes from never pinned down what "digital certificate" should concretely be, so this ticket ships the minimum that's actually specified (a visible record of participation exists) and leaves a richer artifact as a follow-up.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `GET /api/registrations/mine` — the authenticated Volunteer's own Registration history (all statuses, not just `CONFIRMED`), mirroring the shape and auth pattern of the existing `GET /api/donations/mine`.
- [ ] `PATCH /api/volunteer-trips/[slug]/batches/[id]` (extended from Ticket 02) gains a completion transition: the owning Fundraiser or an Admin can mark an `OPEN` Batch `COMPLETED` once its `endDate` has passed, mirroring how a Campaign's `Completed` status is set by "Fundraiser atau Admin" per this project's existing convention.
- [ ] A Batch cannot be marked `COMPLETED` before its `endDate`.
- [ ] A Batch that was `CANCELLED` (Ticket 05) cannot also be marked `COMPLETED`.
- [ ] A `CONFIRMED` Registration on a `COMPLETED` Batch is visibly marked as a completed participation record wherever `GET /api/registrations/mine` shows it — this is the "record of participation" the ticket's scope stops at; no PDF or downloadable certificate is required to satisfy this criterion.

**Context:** Ticket 6 of 6 from `.scratch/volunteer-trip/spec.md`. See its Out of Scope section on why this ticket is deliberately narrow about "certificate."
