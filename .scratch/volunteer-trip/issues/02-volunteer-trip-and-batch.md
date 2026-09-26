# 02: Volunteer Trip and Batch — Fundraiser creates, Verifier moderates, public browses

**What to build:** A Fundraiser can create a Volunteer Trip (destination, itinerary, Trip Fee) and add Volunteer Batches to it (a date range, a maximum quota, and a minimum viable quota), submit it for review, and see it go through the same kind of moderation a Campaign already does. A Verifier has a queue of submitted Trips — separate from the Campaign queue — and approves or rejects with a reason. Once approved, the Trip and its open Batches are visible on a public catalog and detail page. This ticket is demoable end to end without touching any money: nothing here collects a Trip Fee yet (Ticket 03).

**Blocked by:** None (can start immediately — touches no money code, independent of Ticket 01)

**Status:** ready-for-agent

- [ ] New `VolunteerTripStatus` enum: `DRAFT`, `SUBMITTED`, `REJECTED`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `COMPLETED`. No `EXPIRED` — a Trip has no single deadline of its own (a Batch's registration deadline is a separate, per-Batch concern, not built in this ticket).
- [ ] New `VolunteerTrip` model: destination, itinerary (free text), a Trip Fee amount shared across every Batch of the Trip, owning Fundraiser, status, slug. Shaped like `Campaign` minus the fields that don't apply (`targetAmount`, `deadline`, `isUrgent`, `isDemo`) plus the fields Campaign doesn't need (`destination`, `itinerary`, Trip Fee amount).
- [ ] New `VolunteerBatchStatus` enum: `OPEN`, `CLOSED`, `CANCELLED`, `COMPLETED`. This ticket only ever produces `OPEN` and (via direct Fundraiser edit while `OPEN`) an edited-but-still-`OPEN` Batch — `CLOSED` (deadline/maxQuota reached), `CANCELLED` (under-quota), and `COMPLETED` are driven by Registration, refund, and completion logic built in later tickets. Model the enum's full value set now so later tickets don't need a schema change to use it.
- [ ] New `VolunteerBatch` model: start date, end date, registration deadline, max quota, min quota (Fundraiser-set per Batch, no platform-wide default), status, belongs to one `VolunteerTrip`.
- [ ] `POST /api/volunteer-trips` — an authenticated user creates a `DRAFT` Trip they own.
- [ ] `PATCH /api/volunteer-trips/[slug]` — the owning Fundraiser edits a `DRAFT`/`REJECTED` Trip, or submits it (→ `SUBMITTED`). Editing an Active Trip, and anything about Suspension or Cancellation, is out of scope for this ticket — build only what a first submission needs.
- [ ] `POST /api/volunteer-trips/[slug]/batches` — the owning Fundraiser adds a Batch to their own Trip.
- [ ] `PATCH /api/volunteer-trips/[slug]/batches/[id]` — the owning Fundraiser edits a Batch while it's `OPEN`. Do **not** build a cancel action here — Batch cancellation for missing minimum quota is Ticket 05's, because it has a refund consequence this ticket has nothing to fulfill it with.
- [ ] `GET /api/volunteer-trips` — public catalog, `ACTIVE` Trips only.
- [ ] `GET /api/volunteer-trips/[slug]` — public detail page, including the Trip's open Batches with their dates and (at this point, always-zero, since no Registration exists yet) remaining quota.
- [ ] `GET /api/moderasi/volunteer-trips` — Verifier's queue of `SUBMITTED` Trips, separate from `GET /api/moderasi/campaigns`.
- [ ] `POST /api/moderasi/volunteer-trips/[id]` — Verifier approves (→ `ACTIVE`) or rejects (→ `REJECTED`) with a reason, mirroring `POST /api/moderasi/campaigns/[id]`.
- [ ] A non-owning Fundraiser cannot edit or submit someone else's Trip or Batch.
- [ ] A Trip cannot be submitted, and a Batch cannot be added, by anyone other than the owning Fundraiser or an Admin.

**Context:** Ticket 2 of 6 from `.scratch/volunteer-trip/spec.md`.
