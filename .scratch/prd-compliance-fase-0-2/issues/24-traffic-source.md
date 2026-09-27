# 24: Traffic Source on Donation

**What to build:** A Fundraiser can see which shared link actually produced Donations.

**Blocked by:** 18

**Status:** in review (PR #59)

- [x] The source parameter on a shared link is recorded on the resulting Donation
- [x] Counts per link are visible to the Fundraiser
- [x] Absent or malformed parameters never block a Donation

## Comments

- 2026-09-27 (agent, PR below). What this PR adds:
  - `Donation.trafficSource` (nullable, capped at 40 chars), populated from
    an untrusted `src` query parameter, sanitized by
    `src/lib/traffic-source.ts`: stripped to `[a-zA-Z0-9_-]`, trimmed,
    capped at 40 chars. Never rejects -- absent, wrong-typed, empty, or
    entirely-unsafe input all resolve to `null`, so a malformed `src` never
    blocks the Donation (verified in `route.enabled.test.ts`).
  - The Campaign page (`CampaignDetailView`) captures `src` off the URL into
    `sessionStorage` on mount, keyed per Campaign
    (`src/lib/traffic-source-capture.ts`). The donate page is a separate
    route where `src` is no longer on the URL, so it reads the captured
    value back and sends it as `trafficSource` on `POST /api/donations`.
  - `ShareModal` tags each channel's outgoing link with its own `src`
    (`whatsapp`, `facebook`, `twitter`, `copy`).
  - New `GET /api/campaigns/[slug]/traffic-sources`: counts of confirmed
    Donations grouped by `trafficSource`, answered only to that Campaign's
    own Fundraiser or an Admin (Campaign visibility rule first, same as
    every other GET under `/api/campaigns/[slug]`, then the stricter
    owner-or-admin capacity check). Rendered as a small "Sumber Kunjungan"
    panel on the Campaign page, which stays empty for anyone the API
    refuses.

  Assumptions flagged, not policy decisions:
  - `ShareModal` is not wired into any page in this repo yet (its Share
    button on the Campaign page is a placeholder with no `onClick`) --
    pre-existing, out of scope here. This PR still tags its links so
    whichever ticket wires it up gets correct attribution for free; the
    functional mechanism (capture -> donate -> API -> counts) works from
    any hand-built `?src=` link regardless.
  - "Counts per link" is read as "counts per distinct `src` value", not
    literal per-URL tracking (no link-shortener or per-link id exists in
    this codebase). A Donation with no captured source is counted under
    `source: null` ("Langsung / tidak diketahui") rather than dropped.
  - Traffic Source capture only runs on the Campaign page itself; a visitor
    who lands directly on `/campaign/[slug]/donate?src=...` (skipping the
    Campaign page) is not captured. Not addressed here as the ticket's
    "shared link" is the Campaign page's own URL.

  Tests: full suite 2995/2995 passing; `npm run ci:local -- test ratchet`
  green (tsc 47 / lint 194, both at baseline, unchanged); migration applies
  cleanly to a fresh Postgres 16 and matches `schema.prisma`
  (`npm run ci:local -- migrations`).
