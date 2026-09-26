# 01: The public Campaign list no longer takes `?status=`

**What to build:** `GET /api/campaigns` reads `?status=` straight from the query string into its filter, so anyone can list unapproved (`?status=pending`), rejected or Suspended Campaigns. No screen uses the parameter. Remove it: the list always shows what it shows by default, and a `status` in the query is ignored. This is a security fix; the broader "effectively Active" rule is ticket 02.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] `?status=pending`, `?status=suspended` and `?status=rejected` return no such Campaign; the default behaviour is otherwise unchanged
- [ ] The client hook `useCampaigns` no longer offers a `status` option
- [ ] Route tests cover the leak as a regression. Full suite green, tsc adds no errors
