# 01: Settlement never marks a Campaign Completed

**What to build:** A Settlement only adds to a Campaign's collected amount. It never changes the Campaign's status, however much has been collected and whatever the status is (Active, Suspended, Cancelled, Completed, Expired). This lands the webhook change already sitting uncommitted in the working tree. It closes the illegal path to Completed that ADR 0004 forbids, and stops a late Settlement from overwriting a Suspension or a Cancellation.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] A Settlement that reaches or passes the target leaves `status` and `lifecycleStatus` untouched and increments only `collectedAmount`
- [x] A Settlement on a Suspended, Cancelled, Completed or Expired Campaign is still recorded and still leaves the status untouched
- [x] Webhook route tests and the donation-flow integration test assert this; the earlier assertions that the webhook completes a Campaign are gone
- [x] The Campaign status dual-write guard stays green (the webhook is either a named status-free writer or still passes the guard)
