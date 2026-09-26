# 01: Volunteer Trip module: submit and moderation, with a status log

**What to build:** A new Volunteer Trip operations module under `src/lib/volunteer/` with `submitTrip` and `decideTripSubmission`. Both:
- lock the Trip through the subject guard, then read it;
- ask the Capacity judgement (FUNDRAISER to submit, VERIFIER to decide);
- use predicated status writes and typed refusals;
- record a row in a new Trip status-change log (additive migration: action, from/to, actor, Capacity, reason, time).

The Trip PATCH (submit) route and the Trip moderation route become thin callers. See `.scratch/volunteer-trip-operations/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] `submitTrip` accepts only from the editable statuses and `decideTripSubmission` only from SUBMITTED, both under the lock. A concurrent change committed before the lock makes the second call 409
- [ ] The Capacity refusals are unchanged: the owner-only submit, and the owning Verifier refused on moderation
- [ ] Every submit and decision writes a Trip log row with actor and Capacity. The migration is verified on a throwaway Postgres, with `migrate diff` empty
- [ ] Routes are thin, and their tests assert mapping only. Full suite green, tsc adds no errors
