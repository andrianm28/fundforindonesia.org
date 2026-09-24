# Ledger Line Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `fundforindonesia.org`'s current generic scaffold palette (blue `#0073E6`/orange `#FF6B35`, plain Inter everywhere) with the Ledger Line brand identity — warm green/terracotta primary/accent, two new record-surface tokens (`ink`, `paper`), a gold `ledger` token reserved exclusively for a motif later tickets introduce, and a second typography register (self-hosted Newsreader serif + JetBrains Mono, for content that is a stated fact/claim of record) alongside the existing everyday sans — landing platform-wide the moment this ticket merges.

**Architecture:** Pure token-layer change. Colors live in TWO places that must change together — `tailwind.config.ts`'s `colors` block AND `src/styles/globals.css`'s `:root` CSS custom properties (a parallel, duplicate definition; several components reference `var(--color-primary)` etc. directly via Tailwind arbitrary values rather than the semantic `bg-primary` class, so updating only one would leave the site half-rebranded). Two new font files, self-hosted the same way this repo's Inter font already is (`src/fonts/`, `next/font/local`), wired into `layout.tsx` as available CSS variables and new `fontFamily.serif`/`fontFamily.mono` Tailwind keys — not yet applied to any page content, which is later tickets' job.

**Tech Stack:** Next.js 14, Tailwind CSS, React, Vitest.

**Spec:** .scratch/ledger-line-visual-refresh/issues/01-ledger-line-foundation-colors-and-typography.md (ticket; parent spec .scratch/ledger-line-visual-refresh/spec.md)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0.

    <akar specflow>/scripts/check-plan-headings.sh    <rencana ini> <task-brief>
    <akar specflow>/scripts/check-seam-constraints.sh <rencana ini> <task-brief>

## Global Constraints

- New/changed color values: `primary`/`brand.DEFAULT` → `#2F7A5F` (was `#0073E6`); `primary-dark`/`brand.accentDark`-equivalent → a proportionally-darker shade of the new green (was `#005BB5`, the old blue's hover-state darkening — `primary-dark` has 10 real call sites, all as a `hover:` darkening of `primary`, never anything semantic beyond that, so it must be kept, just re-derived from the new green); `accent`/`brand.accent` → `#D97748` (was `#FF6B35`); new `ink` → `#1C1A15`; new `paper` → `#FDFBF8`; new `ledger` → `#B8862E`.
- `ledger` is used NOWHERE in this ticket's own diff except being defined as an available token — it must not appear on any button, nav item, hover state, or any other element this ticket touches.
- No new semantic colors for success/warning/error/info — already correct, untouched.
- Colors must change in BOTH `tailwind.config.ts` and `src/styles/globals.css`'s `:root` block, in sync — 14 real call sites reference `var(--color-*)` directly (`HeroBanner.tsx`, `DesktopHeader.tsx`) rather than Tailwind's semantic classes, and updating only `tailwind.config.ts` would leave those specific elements the old color.
- Two new self-hosted fonts: Newsreader (serif, for prose that is a claim of record) and JetBrains Mono (for numbers/IDs shown as stated fact) — NOT fetched from Google Fonts at build time, for the same reason Inter already isn't (the Docker build has no reliable route to fonts.googleapis.com).
- The existing everyday sans register stays self-hosted Inter — a deliberate ruling, not a silent default: Inter is already self-hosted and working at zero extra risk, `ffi`'s own Plus Jakarta Sans choice is a detail of a codebase this repo isn't literally porting code from (per the parent spec's own source-of-truth split), and the Ledger Line concept only requires one clear everyday register distinct from the Record register — which Inter already satisfies.
- A real audit of every existing `text-primary`/`bg-primary`/`text-accent`/`bg-accent`/`var(--color-primary...)`/etc. call site (85 total across `.tsx`/`.ts` files, confirmed by grep) confirming none was relying on the OLD blue/orange's specific semantic meaning in a way the new green/terracotta would silently break.
- Existing tests asserting a specific color value get their expected VALUE updated to the new one; the assertion's INTENT must not be weakened or removed.
- Out of scope for this ticket: applying `ledger`/the Record register to any actual page content (later tickets' job); any component, route, or layout change beyond the token/font layer; a visual-regression testing tool.

---

### Task 1: Rebrand the color tokens, in both places, verified against real usage

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/styles/globals.css`
- Modify: any existing test file whose expected color value needs updating (found during Step 5's audit — read each hit, do not assume a fixed list up front)

**Interfaces:**
- Consumes: nothing from an earlier task (this is the first task).
- Produces: the new color values (`#2F7A5F` primary, its derived dark hover shade, `#D97748` accent, `#1C1A15` ink, `#FDFBF8` paper, `#B8862E` ledger) as both Tailwind classes (`bg-primary`, `text-ink`, etc.) and CSS custom properties (`var(--color-primary)`, `var(--color-ink)`, etc.) — Task 2 and every later ticket in this set rely on these being real, working tokens in both forms.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah komponen/route test yang sudah ada yang menguji perilaku nyata (misalnya sebuah test yang assert bahwa elemen tertentu me-resolve ke `bg-primary`, atau ke nilai warna tertentu) -- BUKAN test snapshot visual baru, yang memang tidak diperkenalkan proyek ini di ticket manapun dalam set ini. Cakup SETIAP test yang ada yang menyentuh warna brand ini, termasuk yang hanya assert secara tidak langsung (misalnya lewat class string penuh), dengan memperbarui NILAI yang diharapkan ke warna baru sambil mempertahankan MAKSUD assertion itu sendiri (bahwa elemen ini memakai warna brand) tanpa melemahkannya.

- [ ] **Step 1: Read both current color definitions in full**

Read `tailwind.config.ts`'s `colors` block and `src/styles/globals.css`'s `:root` block completely before editing. Current `tailwind.config.ts` (`extend.colors`):

```typescript
colors: {
  primary: {
    DEFAULT: "#0073E6",
    dark: "#005BB5",
  },
  accent: "#FF6B35",
  success: "#00C853",
  warning: "#FFB300",
  danger: "#D50000",
  bg: {
    DEFAULT: "#FFFFFF",
    secondary: "#F5F5F5",
  },
  text: {
    DEFAULT: "#212121",
    secondary: "#757575",
  },
  border: "#E0E0E0",
},
```

Current `src/styles/globals.css` `:root` block (colors section only — the file also has typography/radius/shadow/transition custom properties below this, not part of this task):

```css
:root {
  /* Colors */
  --color-primary: #0073E6;
  --color-primary-dark: #005BB5;
  --color-accent: #FF6B35;
  --color-success: #00C853;
  --color-warning: #FFB300;
  --color-danger: #D50000;
  --color-bg: #FFFFFF;
  --color-bg-secondary: #F5F5F5;
  --color-text: #212121;
  --color-text-secondary: #757575;
  --color-border: #E0E0E0;
  ...
}
```

- [ ] **Step 2: Update `tailwind.config.ts`**

Change the `colors` block to:

```typescript
colors: {
  primary: {
    DEFAULT: "#2F7A5F",
    dark: "#255F4A",
  },
  accent: "#D97748",
  ink: "#1C1A15",
  paper: "#FDFBF8",
  ledger: "#B8862E",
  success: "#00C853",
  warning: "#FFB300",
  danger: "#D50000",
  bg: {
    DEFAULT: "#FFFFFF",
    secondary: "#F5F5F5",
  },
  text: {
    DEFAULT: "#212121",
    secondary: "#757575",
  },
  border: "#E0E0E0",
},
```

(`#255F4A` is `#2F7A5F` darkened ~20%, the same proportional darkening the old `#0073E6` → `#005BB5` pair used, keeping `primary-dark`'s existing role as a hover-state darkening of the brand color, not a new named brand color of its own.)

- [ ] **Step 3: Update `src/styles/globals.css`**

Change the `:root` block's color section to:

```css
  /* Colors */
  --color-primary: #2F7A5F;
  --color-primary-dark: #255F4A;
  --color-accent: #D97748;
  --color-ink: #1C1A15;
  --color-paper: #FDFBF8;
  --color-ledger: #B8862E;
  --color-success: #00C853;
  --color-warning: #FFB300;
  --color-danger: #D50000;
  --color-bg: #FFFFFF;
  --color-bg-secondary: #F5F5F5;
  --color-text: #212121;
  --color-text-secondary: #757575;
  --color-border: #E0E0E0;
```

Leave every other custom property in this file (`--font-family`, `--radius-*`, `--shadow-*`, `--transition-*`, `--safe-area-*`) untouched — Task 2 updates `--font-family`-adjacent additions, nothing else in this file changes.

- [ ] **Step 4: Fix the two hardcoded fallback values in `HeroBanner.tsx`**

`src/components/home/HeroBanner.tsx:159` hardcodes the OLD colors as CSS-variable fallbacks:

```typescript
className="inline-flex items-center justify-center bg-[var(--color-primary,#0073E6)] hover:bg-[var(--color-primary-dark,#005BB5)] text-white font-semibold text-sm md:text-base px-4 md:px-6 py-2 md:py-3 rounded-lg transition-colors duration-200 w-fit"
```

Since `--color-primary`/`--color-primary-dark` are now always defined (Step 3), these fallbacks are dead code that would only ever matter if the CSS variable failed to load — but they're stale and misleading to a future reader either way. Update the fallback values to match the new colors:

```typescript
className="inline-flex items-center justify-center bg-[var(--color-primary,#2F7A5F)] hover:bg-[var(--color-primary-dark,#255F4A)] text-white font-semibold text-sm md:text-base px-4 md:px-6 py-2 md:py-3 rounded-lg transition-colors duration-200 w-fit"
```

- [ ] **Step 5: Audit every remaining color call site**

Run: `grep -rn "text-primary\|bg-primary\|border-primary\|text-accent\|bg-accent\|border-accent\|primary-dark" src --include="*.tsx" --include="*.ts" | grep -v "\.test\."` and `grep -rn "var(--color-primary\|var(--color-accent" src --include="*.tsx" --include="*.ts" | grep -v "\.test\."`.

Read every hit (this repo has 85 across the first pattern set, all in component/page files — read each one, don't sample). For each, confirm the color is being used for brand identity (a button, a link, a highlighted price, an active-tab indicator tied to the brand, etc.) and not for something the OLD blue/orange happened to carry a DIFFERENT meaning for that the new green/terracotta would silently change (e.g., a status or category color that happens to reuse `accent` for a reason unrelated to branding). Record what you checked and confirmed in your task report — a bare "audited, found nothing" is not enough; name at least the categories of usage found (buttons, links, badges, etc.) and confirm each category's meaning is genuinely just "brand color," not something narrower the rebrand changes the meaning of.

- [ ] **Step 6: Update any test asserting a specific old color value**

Run: `grep -rln "#0073E6\|#005BB5\|#FF6B35\|0073E6\|005BB5\|FF6B35" src --include="*.test.tsx" --include="*.test.ts"`. For each match, read the test, confirm what it's actually asserting (the brand color renders correctly on X), and update the expected value to the new hex — never delete or weaken the assertion itself.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS, 0 failures. Any failure here is either a Step 6 miss (an old-color assertion not yet updated) or a real regression from Step 4/5 — investigate, don't skip.

- [ ] **Step 8: Manual verification**

Start the dev server (`npm run dev`) and visually confirm, in a real browser, on all three surfaces the ticket's own acceptance criteria name: the homepage (hero CTA button, header nav hover states, campaign card donate buttons), a campaign detail page (e.g. `/campaign/[slug]` for any real campaign — its own donate button and any brand-colored element), and at least one static page (e.g. `/faq`) — confirm the new green/terracotta renders everywhere checked, with no old blue/orange remaining on any of the three. Note what was checked, on which pages, in your task report.

- [ ] **Step 9: Commit**

```bash
git add tailwind.config.ts src/styles/globals.css src/components/home/HeroBanner.tsx
# plus any test files updated in Step 6
git commit -m "feat: rebrand to the Ledger Line color palette

tailwind.config.ts and globals.css both changed in sync -- 14 call sites
reference the CSS custom properties directly via arbitrary Tailwind values,
not just the semantic classes, so updating only one file would have left
the site half-rebranded. Audited all 85 existing primary/accent call sites;
none relied on the old blue/orange's specific meaning beyond brand identity.
ledger/ink/paper are new, unused-by-anything-yet tokens for later tickets.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```

---

### Task 2: Self-host the Record register typography

**Files:**
- Create: `src/fonts/Newsreader-Variable.woff2` (already downloaded to this path in this worktree — verify it's present and a valid woff2, do not re-download)
- Create: `src/fonts/JetBrainsMono-Variable.woff2` (already downloaded to this path in this worktree — verify it's present and a valid woff2, do not re-download)
- Modify: `src/app/layout.tsx`
- Modify: `tailwind.config.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (different files), though both tasks together complete this ticket's full scope.
- Produces: `font-serif` and `font-mono` Tailwind utility classes resolving to the new self-hosted fonts (via new `fontFamily.serif`/`fontFamily.mono` keys and new CSS variables `--font-newsreader`/`--font-jetbrains-mono` on `<body>`), available for later tickets in this set to apply to real page content. Not applied to any content in this task itself.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah manual browser verification -- proyek ini tidak punya tooling visual-regression, dan ticket ini secara eksplisit tidak memperkenalkannya. Cakup SETIAP hal yang disebut kriteria penerimaan ticket ini MELALUI seam itu: kedua font baru benar-benar termuat (bukan fallback ke font sistem), dan tidak ada elemen halaman manapun yang diam-diam berubah tampilan karena perubahan `fontFamily` Tailwind ini (`font-sans` tetap Inter, tidak berubah).

- [ ] **Step 1: Verify the pre-downloaded font files**

Run: `file src/fonts/Newsreader-Variable.woff2 src/fonts/JetBrainsMono-Variable.woff2`
Expected: both report `Web Open Font Format (Version 2)`. These were downloaded from `fonts.gstatic.com` (the real static files Google's own CSS serves for `Newsreader:wght@200..800` and `JetBrains+Mono:wght@100..800` respectively — genuine variable-weight font files, not generated or approximated), the same way `src/fonts/Inter-Variable.woff2` already was for the existing Inter self-hosting fix. If either file is missing from this worktree, that fix needs re-doing before continuing — do not proceed without both real files present.

- [ ] **Step 2: Read the existing Inter self-hosting pattern in full**

Read `src/app/layout.tsx` completely. The existing pattern (already on `main`):

```typescript
import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/styles/globals.css";
import { Providers } from "@/components/layout/Providers";
import { AppShell } from "@/components/layout/AppShell";
import { ConditionalFooter } from "@/components/layout/ConditionalFooter";

// Self-hosted, not next/font/google: the Docker build has no reliable route
// to fonts.googleapis.com, so a build-time fetch there is a build that can
// fail for reasons that have nothing to do with this codebase. This is the
// same variable-weight Latin-subset file Google's own CSS would have served
// (fonts.gstatic.com/s/inter/v20/...1ZL7.woff2), vendored once instead of
// fetched on every build.
const inter = localFont({
  src: "../fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  weight: "100 900",
});
```

- [ ] **Step 3: Add the two new fonts to `layout.tsx`**

Add, after the existing `inter` declaration:

```typescript
// Same self-hosting reasoning as Inter above: no reliable build-time route
// to fonts.googleapis.com. These are the real variable-weight Latin-subset
// files Google's own CSS serves for Newsreader:wght@200..800 and
// JetBrains+Mono:wght@100..800 respectively -- vendored once, not fetched
// per build. This is the Record register (src/lib -- see the Ledger Line
// spec, .scratch/ledger-line-visual-refresh/spec.md): serif for prose that
// is a claim of record, mono for numbers/IDs shown as stated fact. Not yet
// applied to any page content -- that's later tickets' job.
const newsreader = localFont({
  src: "../fonts/Newsreader-Variable.woff2",
  variable: "--font-newsreader",
  weight: "200 800",
});

const jetbrainsMono = localFont({
  src: "../fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
});
```

Update the `<body>` element's `className` from:

```typescript
<body className={`${inter.variable} font-sans antialiased`}>
```

to:

```typescript
<body className={`${inter.variable} ${newsreader.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
```

(`font-sans` stays as the default — this only makes the two new font variables available as CSS custom properties platform-wide; it does not change what any existing element renders as.)

- [ ] **Step 4: Add `fontFamily.serif`/`fontFamily.mono` to `tailwind.config.ts`**

In the same `extend` block Task 1 touched (`fontFamily`), add two new keys alongside the existing `sans`:

```typescript
fontFamily: {
  sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
  serif: ["var(--font-newsreader)", "Georgia", "serif"],
  mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
},
```

(Tailwind's own default `font-mono` utility currently falls back to its generic built-in monospace stack, since no `mono` key was previously defined here — this makes `font-mono` resolve to the real loaded JetBrains Mono webfont instead, for whichever later ticket uses it.)

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS, 0 failures — this task changes no component logic, so any failure here is unexpected and needs investigating before continuing.

- [ ] **Step 6: Manual verification**

Start the dev server and confirm in the browser dev tools (Network tab or Elements → Computed styles) that both new fonts actually load as network requests / are present as loaded `@font-face` rules — not silently falling back to a system font because of a typo in the `src` path. Separately, spot-check that an ordinary page (e.g. the homepage) still renders in Inter exactly as before — `font-sans` on `<body>` is unchanged, so nothing should look different yet.

- [ ] **Step 7: Commit**

```bash
git add src/fonts/Newsreader-Variable.woff2 src/fonts/JetBrainsMono-Variable.woff2 src/app/layout.tsx tailwind.config.ts
git commit -m "feat: self-host the Record register typography (Newsreader + JetBrains Mono)

Wired as available font-serif/font-mono Tailwind utilities and CSS
variables, not yet applied to any page content -- that's later tickets'
job. The everyday sans register stays Inter, a deliberate ruling: it's
already self-hosted and working, and the Ledger Line concept only needs
one clear everyday register distinct from this new Record one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```
