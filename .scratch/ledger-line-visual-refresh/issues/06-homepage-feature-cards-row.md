# 06: Homepage feature-cards row

**What to build:** The homepage's existing row of six circular icon+label
cards (Donasi, Zakat, Galang Dana, Experience, Kolaborasi CSR, Asuransi) is
restyled consistent with the Ledger Line brand, and stops silently presenting
three of its six entries as if they lead somewhere real when they currently
all fall back to the generic `/explore/all` page — the same "never claim
what isn't backed by something real" discipline the rest of this redesign
applies elsewhere on the platform.

**Blocked by:** 01

**Status:** done

- [x] Donasi (`/explore/all`) and Galang Dana (`/campaign/create`) cards are
      restyled with the new brand colors; their existing links are unchanged.
- [x] The "Asuransi" card is removed from the row entirely.
- [x] The "Kolaborasi CSR" card gets an honest "coming soon" treatment — no
      click-through to `/explore/all` pretending to be a real feature.
- [x] Verified in-browser: the row renders as five visually-consistent tiles
      and no sixth "Asuransi" tile.

**Superseded during implementation (2026-09-25):** the final whole-branch
review found `docs/PRD-fund-for-indonesia.md` (revised 2026-09-22, more
recent than this ticket's own spec/grilling) describes a different homepage
menu than this ticket originally planned — Donasi, Galang Dana, Kolaborasi
CSR, Wakaf, Hibah, with Zakat folded under Donasi (not its own tile) and
Volunteer moved to a secondary menu (not a homepage tile at all). The user
confirmed matching the PRD. Shipped instead of the original plan:
- Zakat and "Experience"/"Volunteer" do NOT get tiles — Zakat keeps its own
  working `/zakat` route (linked from the hero banner and `DesktopHeader`,
  just not from a dedicated homepage tile); Volunteer Trip has no frontend
  and is out of scope per the PRD's own menu placement.
- Wakaf and Hibah get NEW honest "coming soon" tiles instead of being
  deferred to a "Campaign `Kind` filter" — that mechanism does not exist
  anywhere in this codebase (`Campaign.category` is a plain string, no
  `Kind` field or enum). The original ticket text above and the parent
  spec's own "Wakaf and Hibah... remain reachable as Campaign `Kind`
  filters" claim were both wrong about the code; do not repeat that claim
  in future tickets.

**Follow-up flagged, not actioned here:** `/zakat` lost its only
always-visible-on-mobile entry point now that it has no dedicated tile —
it's reachable via the hero banner (one slide) and `DesktopHeader` (`lg:`
only), not from anywhere on a mobile viewport otherwise. Worth its own
ticket if this is judged like a genuine navigation gap rather than an
accepted consequence of the PRD's own "Zakat lives under Donasi" design.
