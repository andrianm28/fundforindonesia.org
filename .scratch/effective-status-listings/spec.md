# Spec: Public listings read the effective status

Status: ready-for-agent
Source: architecture review of 2026-09-25, candidate 3, and the grilling that followed. `CONTEXT.md` (Campaign Status, which now says what public listings show); ADR 0004 and 0015.

## Problem Statement

Every public list of Campaigns filters on the legacy string `status: 'active'` and ignores the deadline. The lists are: the home page (including the Urgent rail), explore by category, explore/all and search (through `GET /api/campaigns`), the zakat API and the sitemap. The effects:

- A Campaign whose deadline has passed keeps appearing as open, and even as Urgent, until someone happens to act on it.
- Donors click through to a page that says the Campaign has ended and offers no donate button.
- `GET /api/campaigns` accepts `?status=` from anyone. `?status=pending` lists Campaigns a Verifier has not yet approved, and `?status=suspended` lists frozen ones. No screen uses the parameter.
- The sitemap promotes nothing that has ended, yet includes nothing it shouldn't only by accident.

## Solution

One reader-side definition, kept next to `effectiveStatus` in the subject guard, decides what public lists show:

- **Listable:** effectively Active, meaning stored ACTIVE with no deadline or a future one. This covers the home page, the Urgent rail, explore, search and the zakat API.
- **Sitemap:** Active, Expired and Completed.
- **Never shown:** Suspended, Cancelled, Submitted, Rejected and Draft.

Readers only filter; they never write a status. `?status=` is removed from the public Campaign list API.

## User Stories

1. As a Donor browsing the home page, I want only Campaigns I can still give to, so that I don't click into ended ones.
2. As a Donor, I want the Urgent rail to drop a Campaign the moment its deadline passes, so that "urgent" is never shown for something closed.
3. As a Donor exploring a category or searching, I want the same rule, so that every list agrees.
4. As a Donor on the zakat page, I want only zakat-eligible Campaigns that are still open, so that I don't pay into a closed one.
5. As a search engine, I want ended Campaigns (Expired, Completed) in the sitemap, so that their transparency pages stay findable.
6. As a Fundraiser whose Campaign is Suspended, Cancelled or not yet approved, I want it listed nowhere public, so that nothing is promoted before or after a Verifier or Admin decision.
7. As the Platform Operator, I want `?status=` gone from the public list API, so that nobody can enumerate unapproved or frozen Campaigns.
8. As an engineer, I want one definition of "listable" used by every public reader, so that the rule changes in one place.
9. As an engineer, I want that definition proven to agree with `effectiveStatus`, so that the list filter and the page banner can never disagree.
10. As an operator, I want public reads never to write status, so that anonymous traffic cannot cause database writes.

## Implementation Decisions

- **Subject guard:** gains `listableCampaignWhere(now)` and `sitemapCampaignWhere(now)`.
  - Both are Prisma `where` fragments over the `lifecycleStatus` enum and `deadline`.
  - Listable: `lifecycleStatus = ACTIVE` and (`deadline` is null or at or after `now`, matching `effectiveStatus`, which expires only when `deadline < now`).
  - Sitemap: `lifecycleStatus` in ACTIVE, EXPIRED or COMPLETED (the same set; an ACTIVE past its deadline is effectively Expired).
  - Callers compose these with their own filters (category, isUrgent, search, zakat).
- **Readers moved to them:** the home page's three queries, explore/[category], `GET /api/campaigns` (which drops `?status=` and ignores it if sent), the zakat campaigns API and the sitemap. None of them reads the legacy `status` string for listing any more.
- **Guards:** the dual-write guard's reader list gains the guard's new functions if needed. A static test pins that no public listing file filters on the legacy `status: 'active'` string.
- **No writes on read:** lazy expiry stays with commands and the future scheduled job (ticket 20).
- **Caching** is unchanged (60 s shared cache on the APIs, `force-dynamic` pages).

## Testing Decisions

- **Good tests** assert what a list returns for a given set of Campaigns and a given `now`, not how the query is built.
- **Agreement test:** a table test runs Campaigns in every stored status with past, future and null deadlines through the in-memory filter (or evaluates the `where` against the rows). It asserts that "listable" equals `effectiveStatus(c, now) === ACTIVE`, and that "in sitemap" equals effective status ∈ {ACTIVE, EXPIRED, COMPLETED}.
- **Reader tests:**
  - `GET /api/campaigns` excludes past-deadline, Suspended and Submitted Campaigns, and `?status=pending` returns no Submitted Campaign (the regression for the leak).
  - The zakat API follows the same rule.
  - The sitemap includes ended Campaigns and excludes Suspended and Cancelled ones.
  - The home page's Urgent query excludes past-deadline Campaigns.
  - Prior art: the existing route tests for these endpoints and `search-filter-intersection.property.test.ts`.

## Out of Scope

- Hiding Demo Campaigns (ticket 26).
- The scheduled expiry job (ticket 20).
- A public "ended Campaigns" list.
- Zakat eligibility by Kind (Kind does not exist yet).
- Any cache-time change.

## Further Notes

Order: ticket 01 (close the `?status=` leak) first, because it is small and a security fix. Ticket 02 (the listing rule everywhere) follows; both touch `GET /api/campaigns`.
