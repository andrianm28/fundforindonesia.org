# Ledger Line Homepage Feature Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The homepage's six quick-action tiles stop silently claiming three fake destinations and one out-of-scope module, and the three real tiles pick up the Ledger Line brand palette -- a Donor sees exactly five tiles: three real, working links restyled in brand colors, and two honestly-labeled "coming soon" tiles for modules with no frontend yet, with the out-of-scope "Asuransi" entry gone entirely.

**Architecture:** The tile data (icon/label/href/color) lives as an inline array literal in `src/app/page.tsx` (a Server Component, async, fetches campaigns via Prisma directly -- not renderable via a plain component test without mocking Prisma and the async boundary). The rendering itself lives in `src/components/home/QuickActionTiles.tsx`, a small, already-separately-tested presentational component. This plan extracts the tile data (and a new discriminated-union type distinguishing a real, linked tile from a "coming soon" one) into `src/lib/home/quickActionTiles.ts`, so the actual content decision this ticket is about -- which 5 tiles exist, which are real links, which are honestly disabled -- is directly unit-testable without touching the Server Component or Prisma at all. `QuickActionTiles.tsx` gains a second rendering branch for `comingSoon` tiles: a non-`<Link>`, visually muted `<div>` with an explicit "Segera hadir" sub-label, so there is no click-through pretending an unbuilt module is live.

**Tech Stack:** Next.js 14, Tailwind CSS, React, Vitest.

**Spec:** .scratch/ledger-line-visual-refresh/issues/06-homepage-feature-cards-row.md (ticket; parent spec .scratch/ledger-line-visual-refresh/spec.md)

**Gerbang:** the `specflow` plugin (and its `check-plan-headings.sh`/`check-seam-constraints.sh` guard scripts) is no longer installed in this environment as of 2026-09-25 -- `~/.claude/skills/specflow` and the plugin cache entry are both gone, replaced by the unwrapped `mattpocock-skills` plugin, which has no equivalent guard scripts. This plan was verified manually against the same two properties those scripts checked: every task heading is `### Task N: <title>` with no non-Task heading between or after them (confirmed by running `task-brief` against this file for each task number and getting a clean single-task extraction), and every task carries its own "Seam constraint (MENGIKAT task ini, dari spec)" block. `docs/agents/issue-tracker.md` should be updated to note this gap for future sessions.

## Global Constraints

- Donasi (`/explore/all`), Zakat (`/zakat`), and Galang Dana (`/campaign/create`) keep their existing, real links unchanged -- only their visual styling changes.
- The card currently labeled "Experience" is relabeled **"Volunteer"** and rendered as an honest "coming soon" tile -- visually distinct from the working tiles (muted/disabled appearance), with no click-through to `/explore/all` or anywhere else pretending to be a real Volunteer feature.
- "Kolaborasi CSR" keeps its label and gets the same honest "coming soon" treatment -- CSR/Program has no frontend either.
- "Asuransi" is removed entirely -- not a placeholder to preserve, confirmed out of this platform's scope.
- Wakaf and Hibah do NOT get new dedicated cards in this ticket -- they stay reachable as Campaign `Kind` filters within Donasi/Explore, the existing pattern. Do not add cards for them.
- The three real tiles' icon-circle background colors change from the current generic Material-style pastels to colors derived from the Ledger Line palette (`primary` `#2F7A5F`, `accent` `#D97748`) -- restrained tints, not the `ledger` gold token (reserved exclusively for the Ledger Line motif elsewhere) and not a new semantic color.
- No Record register (serif/mono) typography on these tiles -- short interactive/informational labels stay in the everyday sans register, matching the parent spec's rule that the gold token and Record register never appear on interactive controls.
- No change to routes, data model, or business logic -- this is a pure content-and-visual change to a static tile list.
- No visual-regression testing tool is introduced -- manual browser verification is the stated seam for the visual appearance itself.
- Existing behavioral test coverage must stay exactly as rigorous as today -- update an assertion's expected value only where this ticket deliberately changes the underlying markup (e.g. the grid's column count), never weaken or drop an assertion's intent.

---

### Task 1: Extract tile data, add the "coming soon" tile treatment, apply Ledger Line colors

**Files:**
- Create: `src/lib/home/quickActionTiles.ts`
- Create: `src/lib/home/quickActionTiles.test.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/home/QuickActionTiles.tsx`
- Modify: `src/components/home/QuickActionTiles.test.tsx`

**Interfaces:**
- Produces: `QuickActionTile` (a discriminated union: `{ icon: string; label: string; href: string; color: string; comingSoon?: false }` for a real tile, or `{ icon: string; label: string; comingSoon: true }` for a coming-soon tile), and `quickActionTiles: QuickActionTile[]` (the actual 5-tile data), both exported from `src/lib/home/quickActionTiles.ts`.
- Consumes: nothing from another task (this is the only task in this plan).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah dua berkas: `src/lib/home/quickActionTiles.test.ts` (data correctness -- the actual content decision this ticket makes: which 5 tiles exist, which are real links, which are coming-soon, exactly the honest-numbering-style discipline the parent spec's "never claim what isn't backed by something real" rule requires) dan `src/components/home/QuickActionTiles.test.tsx` (rendering behavior -- an existing component test suite, per the parent spec's Testing Decisions section naming existing component tests as this ticket set's seam). Cakup SETIAP perilaku task ini MELALUI kedua seam itu: exact tile count and identity, comingSoon tiles rendering as non-links with the "Segera hadir" label and no href anywhere, working tiles keeping their real hrefs and colors, the grid's column count matching the new tile count. Nilai harapan dalam test adalah literal yang diketahui (`'Volunteer'`, `'/campaign/create'`, `'Segera hadir'`, hex color strings, tile counts), bukan dihitung ulang dari kode.

**Facts gathered (do not re-derive):**

Current `quickActionTiles` array, inline in `src/app/page.tsx` (lines 49-57) -- the exact data this task replaces:
```typescript
// Quick action tiles
const quickActionTiles = [
  { icon: '💰', label: 'Donasi', href: '/explore/all', color: '#E3F2FD' },
  { icon: '🕌', label: 'Zakat', href: '/zakat', color: '#E8F5E9' },
  { icon: '📢', label: 'Galang Dana', href: '/campaign/create', color: '#FFF3E0' },
  { icon: '✨', label: 'Experience', href: '/explore/all', color: '#E0F7FA' },
  { icon: '🤝', label: 'Kolaborasi CSR', href: '/explore/all', color: '#FCE4EC' },
  { icon: '🛡️', label: 'Asuransi', href: '/explore/all', color: '#E8EAF6' },
];
```
Used at `page.tsx` line 185: `<QuickActionTiles tiles={quickActionTiles} />`. Confirmed by reading the whole file: Donasi, Experience, and Kolaborasi CSR all currently point at the generic `/explore/all` fallback (Zakat and Galang Dana already have real, distinct destinations) -- Asuransi does too, but it's being removed entirely, not redirected.

Current `src/components/home/QuickActionTiles.tsx` (full file, 39 lines) -- the component this task modifies:
```tsx
import Link from "next/link";

export interface QuickActionTilesProps {
  tiles: {
    icon: string;
    label: string;
    href: string;
    color: string;
  }[];
}

export default function QuickActionTiles({ tiles }: QuickActionTilesProps) {
  return (
    <section className="px-4 py-4">
      <div className="grid grid-cols-4 gap-3 sm:gap-4 md:grid-cols-5 lg:grid-cols-8">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex flex-col items-center gap-2 group"
          >
            <div
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-xl sm:text-2xl transition-transform duration-normal group-hover:scale-105"
              style={{ backgroundColor: tile.color }}
            >
              <span role="img" aria-label={tile.label}>
                {tile.icon}
              </span>
            </div>
            <span className="text-[11px] sm:text-xs text-text text-center leading-tight font-medium line-clamp-2">
              {tile.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

Existing `src/components/home/QuickActionTiles.test.tsx` (full file, 97 lines) -- read in full. Its own `mockTiles` fixture (7 generic tiles, independent of the real `page.tsx` data, none using `comingSoon`) covers: all labels render, correct icons per tile, correct href per link, correct background color per icon, a `grid-cols-4` assertion on the grid wrapper, and an empty-tiles-array case. Every one of these except the `grid-cols-4` assertion is unaffected by this task (none of the mock tiles are `comingSoon`, so the existing `<Link>`-rendering branch and its behavior is untouched). Only the `grid-cols-4` assertion needs its expected value updated, since this task deliberately changes the grid's column classes (see Step 3) -- its *intent* (verify the grid uses the correct column count for the tile count) stays the same, only the literal expected class changes.

`primary` (`#2F7A5F`) and `accent` (`#D97748`) are already defined in `tailwind.config.ts`'s `colors` block by ticket 01 (merged to `main`). This task derives light background tints from them (not raw `theme()`/CSS-variable references -- these are literal inline `style` hex values, matching this codebase's own established pattern for per-item inline background colors, e.g. `ProgressBar.tsx`'s and `CampaignCard`'s existing hardcoded hex usage): `#E7F2ED` and `#D3E7DC` (two tints of `primary`, for Donasi and Zakat respectively -- distinguishable from each other while both reading as "on-brand green"), and `#FBEAE3` (a tint of `accent`, for Galang Dana -- matching `accent`'s own defined role in ticket 01's token table, "CTAs that must stand out," since Galang Dana is the platform's fundraising-creation call to action).

- [ ] **Step 1: Write the failing tests for the extracted tile data**

Create `src/lib/home/quickActionTiles.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { quickActionTiles } from './quickActionTiles';

describe('quickActionTiles', () => {
  it('has exactly five tiles', () => {
    expect(quickActionTiles).toHaveLength(5);
  });

  it('does not include an Asuransi tile', () => {
    const labels = quickActionTiles.map((tile) => tile.label);
    expect(labels).not.toContain('Asuransi');
  });

  it('does not include an Experience tile -- it is relabeled Volunteer', () => {
    const labels = quickActionTiles.map((tile) => tile.label);
    expect(labels).not.toContain('Experience');
    expect(labels).toContain('Volunteer');
  });

  it('keeps Donasi, Zakat, and Galang Dana as real, working links', () => {
    const donasi = quickActionTiles.find((tile) => tile.label === 'Donasi');
    const zakat = quickActionTiles.find((tile) => tile.label === 'Zakat');
    const galangDana = quickActionTiles.find((tile) => tile.label === 'Galang Dana');

    expect(donasi).toMatchObject({ href: '/explore/all', comingSoon: undefined });
    expect(zakat).toMatchObject({ href: '/zakat', comingSoon: undefined });
    expect(galangDana).toMatchObject({ href: '/campaign/create', comingSoon: undefined });
  });

  it('marks Volunteer and Kolaborasi CSR as coming soon, with no href', () => {
    const volunteer = quickActionTiles.find((tile) => tile.label === 'Volunteer');
    const csr = quickActionTiles.find((tile) => tile.label === 'Kolaborasi CSR');

    expect(volunteer).toMatchObject({ comingSoon: true });
    expect(csr).toMatchObject({ comingSoon: true });
    expect(volunteer).not.toHaveProperty('href');
    expect(csr).not.toHaveProperty('href');
  });

  it('gives every real tile a Ledger Line brand color, not the old generic pastels', () => {
    const oldPastels = ['#E3F2FD', '#E8F5E9', '#FFF3E0', '#E0F7FA', '#FCE4EC', '#E8EAF6'];
    quickActionTiles.forEach((tile) => {
      if (!tile.comingSoon) {
        expect(oldPastels).not.toContain(tile.color);
      }
    });
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/lib/home/quickActionTiles.test.ts`
Expected: FAIL with a module-not-found error (`src/lib/home/quickActionTiles.ts` doesn't exist yet).

- [ ] **Step 3: Create `src/lib/home/quickActionTiles.ts`**

```typescript
export interface QuickActionWorkingTile {
  icon: string;
  label: string;
  href: string;
  color: string;
  comingSoon?: false;
}

export interface QuickActionComingSoonTile {
  icon: string;
  label: string;
  comingSoon: true;
}

export type QuickActionTile = QuickActionWorkingTile | QuickActionComingSoonTile;

/**
 * The homepage's quick-action tiles. Donasi, Zakat, and Galang Dana are real,
 * working destinations, restyled in tints of the Ledger Line brand colors
 * (`primary` for the two giving actions, `accent` for the fundraising CTA,
 * matching accent's own role as "CTAs that must stand out"). Volunteer
 * (formerly "Experience") and Kolaborasi CSR are honestly marked
 * `comingSoon` -- neither module has a frontend yet -- so QuickActionTiles
 * renders them as disabled, non-clickable tiles instead of silently falling
 * back to /explore/all pretending to be a real feature. Asuransi is not a
 * real platform module and has no entry here at all. Wakaf and Hibah stay
 * reachable as Campaign Kind filters within Donasi/Explore -- they do not
 * get dedicated cards here.
 */
export const quickActionTiles: QuickActionTile[] = [
  { icon: '💰', label: 'Donasi', href: '/explore/all', color: '#E7F2ED' },
  { icon: '🕌', label: 'Zakat', href: '/zakat', color: '#D3E7DC' },
  { icon: '📢', label: 'Galang Dana', href: '/campaign/create', color: '#FBEAE3' },
  { icon: '✨', label: 'Volunteer', comingSoon: true },
  { icon: '🤝', label: 'Kolaborasi CSR', comingSoon: true },
];
```

- [ ] **Step 4: Run `quickActionTiles.test.ts` to verify all tests pass**

Run: `npx vitest run src/lib/home/quickActionTiles.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Wire `page.tsx` to import the extracted data**

In `src/app/page.tsx`, replace:
```typescript
// Quick action tiles
const quickActionTiles = [
  { icon: '💰', label: 'Donasi', href: '/explore/all', color: '#E3F2FD' },
  { icon: '🕌', label: 'Zakat', href: '/zakat', color: '#E8F5E9' },
  { icon: '📢', label: 'Galang Dana', href: '/campaign/create', color: '#FFF3E0' },
  { icon: '✨', label: 'Experience', href: '/explore/all', color: '#E0F7FA' },
  { icon: '🤝', label: 'Kolaborasi CSR', href: '/explore/all', color: '#FCE4EC' },
  { icon: '🛡️', label: 'Asuransi', href: '/explore/all', color: '#E8EAF6' },
];
```
with:
```typescript
import { quickActionTiles } from '@/lib/home/quickActionTiles';
```
placed alongside the file's other top-of-file imports (after the existing `import type { PrayerStreamItem } from '@/lib/hooks/usePrayerStream';` line). The `<QuickActionTiles tiles={quickActionTiles} />` call at line 185 does not change.

- [ ] **Step 6: Write the failing tests for the component's `comingSoon` rendering**

Add to `src/components/home/QuickActionTiles.test.tsx`, inside the existing `describe("QuickActionTiles", ...)` block (do not remove or alter the existing tests except the one named in Step 8):

```tsx
  it("renders a coming-soon tile as a non-link, muted, honestly-labeled tile", () => {
    const tilesWithComingSoon = [
      { icon: "💰", label: "Donasi", href: "/donasi", color: "#E3F2FD" },
      { icon: "✨", label: "Volunteer", comingSoon: true as const },
    ];
    const { container } = render(<QuickActionTiles tiles={tilesWithComingSoon} />);
    const section = container.querySelector("section")!;
    const scope = within(section);

    expect(scope.getByText("Volunteer")).toBeInTheDocument();
    expect(scope.getByText("Segera hadir")).toBeInTheDocument();

    const links = section.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/donasi");
  });

  it("does not render an href anywhere for a coming-soon tile", () => {
    const tilesWithComingSoon = [
      { icon: "🤝", label: "Kolaborasi CSR", comingSoon: true as const },
    ];
    const { container } = render(<QuickActionTiles tiles={tilesWithComingSoon} />);
    const anchors = container.querySelectorAll("a[href]");
    expect(anchors).toHaveLength(0);
  });
```

This file's top imports `{ render, screen, within }` from `@testing-library/react` already -- `within` is already available, no new import needed.

- [ ] **Step 7: Run the new tests to verify they fail**

Run: `npx vitest run src/components/home/QuickActionTiles.test.tsx`
Expected: the 2 new tests FAIL (`comingSoon` isn't handled yet -- the component tries to render every tile as a `<Link>`, which crashes or renders `href="undefined"` for the coming-soon fixture). Every pre-existing test still PASSES.

- [ ] **Step 8: Update `QuickActionTiles.tsx` and the grid-column test**

Replace the full contents of `src/components/home/QuickActionTiles.tsx` with:

```tsx
import Link from "next/link";
import type { QuickActionTile } from "@/lib/home/quickActionTiles";

export interface QuickActionTilesProps {
  tiles: QuickActionTile[];
}

export default function QuickActionTiles({ tiles }: QuickActionTilesProps) {
  return (
    <section className="px-4 py-4">
      <div className="grid grid-cols-5 gap-3 sm:gap-4">
        {tiles.map((tile) =>
          tile.comingSoon ? (
            <div
              key={tile.label}
              className="flex flex-col items-center gap-2"
              aria-disabled="true"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-xl sm:text-2xl bg-bg-secondary grayscale opacity-60">
                <span role="img" aria-label={tile.label}>
                  {tile.icon}
                </span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[11px] sm:text-xs text-text-secondary text-center leading-tight font-medium line-clamp-2">
                  {tile.label}
                </span>
                <span className="text-[9px] text-text-secondary/70">Segera hadir</span>
              </div>
            </div>
          ) : (
            <Link
              key={tile.href}
              href={tile.href}
              className="flex flex-col items-center gap-2 group"
            >
              <div
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-xl sm:text-2xl transition-transform duration-normal group-hover:scale-105"
                style={{ backgroundColor: tile.color }}
              >
                <span role="img" aria-label={tile.label}>
                  {tile.icon}
                </span>
              </div>
              <span className="text-[11px] sm:text-xs text-text text-center leading-tight font-medium line-clamp-2">
                {tile.label}
              </span>
            </Link>
          )
        )}
      </div>
    </section>
  );
}
```

Then, in `src/components/home/QuickActionTiles.test.tsx`, update the existing grid-column test (its assertion's intent -- verify the grid uses the correct column count -- is unchanged; only the literal expected class moves, since this task changes the grid from a 6-tile-oriented 4/5/8 responsive count to a fixed 5-column grid matching the new, fixed 5-tile count):

```tsx
  it("renders a 5-column grid layout", () => {
    const { container } = render(<QuickActionTiles tiles={mockTiles} />);
    const grid = container.querySelector(".grid");

    expect(grid).toHaveClass("grid-cols-5");
  });
```

Replace the existing `it("renders a 4-column grid layout", ...)` test with this one -- same position in the file, same structure, only the title and expected class change.

- [ ] **Step 9: Run `QuickActionTiles.test.tsx` to verify all tests pass**

Run: `npx vitest run src/components/home/QuickActionTiles.test.tsx`
Expected: all tests PASS -- the 2 new `comingSoon` tests, the updated grid-column test, and every other pre-existing test unmodified.

- [ ] **Step 10: Run the full test suite**

Run: `npx vitest run`
Expected: all test files PASS, including both new/modified files above and every other suite in the repo (this task touches no other component or route).

- [ ] **Step 11: Manual browser verification**

Start the dev server (`npm run dev`) and visit the homepage (`/`). Confirm:
- Exactly five tiles render: Donasi, Zakat, Galang Dana, Volunteer, Kolaborasi CSR -- no sixth "Asuransi" tile anywhere.
- Donasi, Zakat, and Galang Dana each show their new Ledger Line-derived tint colors (two greens, one terracotta) instead of the old rainbow of Material pastels, and each still navigates to its real destination when clicked.
- Volunteer and Kolaborasi CSR render visually muted/grayscale, are not clickable, and each shows "Segera hadir" beneath the label.
- The five tiles sit in a single, evenly-spaced row (no awkward wrapping) at a typical mobile viewport width.

If the dev environment has no seeded data or another blocker prevents visiting the real homepage, read the compiled/rendered output via the component test suite's DOM output as a documented substitute (proves the classes/content are wired, not real paint), and note the blocker explicitly in the task report -- do not silently skip this verification.

- [ ] **Step 12: Commit**

```bash
git add src/lib/home/quickActionTiles.ts src/lib/home/quickActionTiles.test.ts src/app/page.tsx src/components/home/QuickActionTiles.tsx src/components/home/QuickActionTiles.test.tsx
git commit -m "feat: restyle homepage quick-action tiles and remove the fake Asuransi/Experience destinations"
```
