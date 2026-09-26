# 10: Prove a pending Cancellation lapses on every exit from Active

**What to build:** The leave-Active hook marks any PENDING Cancellation request SUPERSEDED whenever a Campaign leaves Active. Ticket 07 could only prove this for the Expired and Cancelled exits, because Completed and Suspended did not exist on its branch. Now that tickets 03 and 05 are merged, prove the other two exits so a later refactor of the hook cannot silently drop them.

**Blocked by:** 03, 05, 07

**Status:** done

- [ ] Marking a Campaign Completed (both the FUNDRAISER and the ADMIN capacity) supersedes its PENDING request in the same transaction
- [ ] Suspending an Active Campaign supersedes its PENDING request; suspending an Expired or Completed Campaign has no pending request to touch (and none is created)
- [ ] After a superseded request, deciding it answers 409 "sudah gugur", and a Suspension that is then lifted does not revive it
- [ ] If any case fails, fix the hook, not the test
