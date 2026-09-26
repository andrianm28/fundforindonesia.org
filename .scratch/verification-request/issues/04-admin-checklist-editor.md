# 04: Admins edit the verification checklist from the panel

**What to build:** An Admin page lets someone with the ADMIN Capacity add, reword, reorder, mark required or optional, and deactivate `VerificationChecklistItem`s. Changes apply to new Verification Requests only; every existing request keeps its snapshot. Items are never hard-deleted. Changes are recorded with actor and time (audit). This fulfils PRD §7.1's "configured from the panel, not code".

**Blocked by:** 01

**Status:** done

- [ ] Only an ADMIN assignment holder can edit; everyone else gets 403 or a redirect
- [ ] Editing or deactivating an item doesn't change the snapshot of any existing request
- [ ] Every change is audited (actor, time, before and after)
- [ ] Full suite green, tsc adds no errors
