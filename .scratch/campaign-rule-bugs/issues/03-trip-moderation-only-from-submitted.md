# 03: A Verifier approves or rejects only a Submitted Volunteer Trip

**What to build:** The Volunteer Trip moderation route (`PATCH /api/moderasi/volunteer-trips/[id]`) writes the new status with a plain update and never checks the current one. A Verifier can "approve" a Trip that is Draft, already Rejected, Active, Suspended, Cancelled or Completed, which reopens registrations on a Trip that was closed. Campaign moderation already accepts only Submitted (C20 ticket 02). Apply the same rule here:
- approve and reject apply only to a Trip whose status is SUBMITTED;
- any other status gets 409, with a typed code and an Indonesian message, and no status change or notification;
- the write is predicated on SUBMITTED, so two Verifiers deciding at once produce one change and one 409.

The existing own-Trip refusal (403 `OWN_TRIP_CONFLICT`) stays as it is. While here, the notification wording drops "moderator", as Campaign moderation did.

Architecture review 2026-09-26, candidate 2, flagged this as a live defect. The full Trip operations module is a separate refactor.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] approve and reject succeed only from SUBMITTED; every other `VolunteerTripStatus` gets 409 with a typed code, and nothing is written
- [ ] The status write is predicated on SUBMITTED; a decision committed first makes the second one 409 (concurrency test)
- [ ] Notification text no longer says "moderator"
- [ ] Route tests cover every status plus the race; the own-Trip and non-owner tests stay green. Full suite green, tsc adds no errors
