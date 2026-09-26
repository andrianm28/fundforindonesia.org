# 01: Ledger Line foundation — brand colors and typography

**What to build:** The platform-wide visual identity changes from the current
generic scaffold (blue `#0073E6` primary, orange `#FF6B35` accent, plain Inter
everywhere) to the Ledger Line brand: warm green/terracotta primary/accent, plus
two new tokens (`ink` for headline-weight text, `paper` for record-surfaces) and
a third (`ledger`, a restrained gold) reserved exclusively for the Ledger Line
motif introduced in later tickets — it must not appear on any button, nav item,
or hover state in this ticket's own work. A second typographic register (serif +
mono, for content that is a stated fact/claim of record, distinct from the
everyday sans register used for navigation/forms/body copy) is added and
self-hosted, ready for later tickets to apply where a real existing-page use
exists. Because the existing `primary`/`accent`/etc. Tailwind keys change
*value*, not *name*, every page in the app inherits the new brand the moment
this ticket lands — visiting any page, including static pages, shows the new
colors with no further per-page work.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] `tailwind.config.ts`'s color tokens updated: `primary`/`brand` → `#2F7A5F`,
      `accent` → `#D97748`, plus new `ink` (`#1C1A15`), `paper` (`#FDFBF8`), and
      `ledger` (`#B8862E`) keys added.
- [ ] A real audit of every existing `text-primary`/`bg-primary`/`text-accent`/
      `bg-accent`/etc. usage across the codebase confirms nothing was relying on
      the *old* blue/orange's specific meaning in a way the new green/terracotta
      breaks (e.g. a status indicator accidentally reusing a brand color for a
      semantic meaning) — not just a value swap with no verification.
- [ ] Two new fonts (Newsreader for prose, JetBrains Mono for numbers/IDs) are
      self-hosted the same way Inter already is (`src/fonts/`, `next/font/local`)
      — not fetched from Google Fonts at build time, for the same reason Inter
      was already switched this way (the Docker build has no reliable route to
      fonts.googleapis.com).
- [ ] A deliberate, recorded decision on whether the existing sans (self-hosted
      Inter) stays as this repo's everyday register, or is replaced with Plus
      Jakarta Sans to match the sibling `ffi` codebase's choice exactly — either
      is acceptable, but the choice must be explicit, not defaulted silently.
- [ ] `ledger` color and the Record register (serif/mono) are wired up as
      available tokens/fonts but not yet applied anywhere in this ticket's own
      diff — their actual application is later tickets' job; this ticket is the
      foundation only.
- [ ] Visiting the homepage, a campaign detail page, and at least one static
      page (e.g. `/faq`) shows the new brand colors with no remaining old
      blue/orange anywhere.
- [ ] Existing component/route tests that assert on a specific color value
      (e.g. asserting a class resolves to the old blue hex) are updated to the
      new expected value — the assertion's *intent* (this button uses the brand
      color) stays unchanged; only the literal expected value moves.
