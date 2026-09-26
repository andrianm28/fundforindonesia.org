# 04: The Campaign page tells Suspended, Cancelled and ended apart

**What to build:** Opening a Campaign by link shows where it stands:
- The donate action is hidden unless the Campaign is effectively Active.
- A neutral banner appears for each closed status:
  - Suspended: "Campaign ini sedang ditinjau dan tidak menerima donasi."
  - Cancelled: "Fundraiser telah menarik Campaign ini."
  - Expired or Completed: "Campaign ini telah berakhir."
- Only the owning Fundraiser also sees the Suspension reason, taken from the latest SUSPENDED status-change row.

See the spec, section "Campaign page", and PRD §8 (a Cancelled Campaign must not look Suspended).

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The public Campaign payload includes `lifecycleStatus`, so the page can decide what to show
- [ ] A Campaign stored Active whose deadline has passed is treated as Expired (effective status)
- [ ] The Suspension reason appears in the payload only for the owning Fundraiser's session; nobody else gets it
- [ ] Banner and hidden donate action for each status, with component tests. An API test covers who gets the reason. Full suite green, tsc adds no errors
