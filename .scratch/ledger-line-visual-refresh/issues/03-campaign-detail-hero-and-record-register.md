# 03: Campaign detail page — hero fix and Record register

**What to build:** A visitor opening a campaign detail page no longer has to
scroll past a full-bleed cover image to see the title, progress, and donate
button on desktop — the hero is capped to a fixed aspect ratio (e.g. 21:9) with
the info panel sitting adjacent on wide viewports instead of stacked beneath a
tall image. Separately, wherever this page shows a donation amount as a stated
fact (e.g. the confirmed/collected total), it renders in the Record register's
mono typeface (from ticket 01) rather than the everyday sans, so it reads as an
attested number, not a marketing figure.

**Blocked by:** 01

**Status:** done

- [ ] `src/app/campaign/[slug]/page.tsx`'s hero image is capped to a fixed
      aspect ratio; on desktop/wide viewports, the title/progress/donate-button
      info panel sits adjacent to the hero, not stacked beneath it, so all
      three are visible without scrolling on a typical desktop viewport.
- [ ] The narrow-viewport (mobile) layout is verified separately — this is a
      desktop-specific fix per the original finding; confirm mobile doesn't
      regress.
- [ ] The confirmed/collected donation amount shown on this page uses the
      Record register's mono typeface (`--font-mono` / JetBrains Mono from
      ticket 01).
- [ ] No other content on this page switches to the Record register — a
      donate button, form field, or any interactive control stays in the
      everyday sans register; only the stated-fact number changes.
- [ ] Verified in-browser: a campaign with a long story/description and a tall
      cover image no longer pushes the donate button below the fold on a
      standard desktop viewport.
