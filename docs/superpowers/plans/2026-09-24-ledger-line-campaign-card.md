# Ledger Line Campaign Card Motif Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the campaign card's progress bar the Ledger Line motif -- a dashed gold repeating-linear-gradient line with fixed 25/50/75% milestone ticks -- so a Donor sees the platform's "this claim is backed by a record" visual language on every campaign card, using the `ledger` gold token ticket 01 introduced and reserved exclusively for this purpose.

**Architecture:** `ProgressBar` (`src/components/ui/ProgressBar.tsx`) is a shared component consumed by three call sites -- `CampaignCard.tsx`, `CampaignDetail.tsx`, and `CampaignDetailView.tsx` -- confirmed by grep before this plan was written. Only `CampaignCard.tsx`'s usage may show the motif; the other two must render exactly as they do today, byte-for-byte unchanged in their default appearance. `ProgressBar` therefore gains one new opt-in prop, `showLedgerLine` (default `false`), which renders a dashed gold `repeating-linear-gradient` background on the track plus three fixed-position tick marks at 25/50/75%, layered *underneath* the existing real-progress fill bar (which keeps its current color/width/animation logic completely unchanged) -- the fill still shows the campaign's true collected percentage; the Ledger Line is a separate, decorative, always-fixed layer beneath it representing the platform's staged-disbursement promise, not this campaign's actual data. Only `CampaignCard.tsx` passes `showLedgerLine`; the other two call sites are untouched.

**Tech Stack:** Next.js 14, Tailwind CSS, React, Vitest.

**Spec:** .scratch/ledger-line-visual-refresh/issues/02-campaign-card-ledger-line-motif.md (ticket; parent spec .scratch/ledger-line-visual-refresh/spec.md)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah
di bawah keluar dengan status 0.

    ~/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-24-ledger-line-campaign-card.md /home/ubuntu/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief
    ~/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-24-ledger-line-campaign-card.md /home/ubuntu/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- The Ledger Line motif renders as a dashed gold rule via a CSS `repeating-linear-gradient` background (NOT an image or SVG).
- Milestone ticks are fixed at 25%, 50%, 75% for EVERY campaign regardless of its real progress or any real disbursement data -- this is a promise about the platform's process, not a report on this specific campaign. Tick positions are never derived from `current`/`target` or any other campaign-specific data.
- The `ledger` color token (`#B8862E`, already defined in `tailwind.config.ts` by ticket 01) is used for this motif and ONLY this motif within `CampaignCard.tsx` -- no button, badge, or other element on the card may pick up the gold token.
- `CampaignDetail.tsx` and `CampaignDetailView.tsx`'s progress bars are explicitly OUT of scope for this ticket -- they must keep rendering the plain flat two-tone bar exactly as today. Only "under a campaign card's progress bar" is in scope here.
- No change to routes, data model, or business logic -- this is a pure visual/CSS/markup change.
- No visual-regression testing tool is introduced -- none exists in this codebase; manual browser verification is the stated seam for the visual appearance itself.
- Existing behavioral test coverage (does the bar reflect the right percentage, correct aria attributes) must stay exactly as rigorous as today -- a visual refresh is not an excuse to weaken behavioral assertions. Only update an assertion's expected literal value where the old value was tied to markup this ticket deliberately replaces; never remove or loosen the assertion's intent.

---

### Task 1: Ledger Line motif on the campaign card's progress bar

**Files:**
- Modify: `src/components/ui/ProgressBar.tsx`
- Modify: `src/components/campaign/CampaignCard.tsx:129` (the `<ProgressBar>` call site)
- Test: `src/components/ui/ProgressBar.test.tsx`
- Test: `src/components/campaign/CampaignCard.test.tsx`

**Interfaces:**
- Produces: `ProgressBarProps.showLedgerLine?: boolean` (default `false`) -- when `true`, the track renders a dashed gold `repeating-linear-gradient` background plus three `<span data-testid="ledger-tick">` elements positioned via inline `style.left` at `'25%'`, `'50%'`, `'75%'`. When omitted or `false`, the track renders exactly as it does today (`bg-bg-secondary`, no ticks) -- zero behavior change for `CampaignDetail.tsx`/`CampaignDetailView.tsx`, which never pass this prop.
- Consumes: nothing from another task (single-task plan).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `src/components/ui/ProgressBar.test.tsx` dan `src/components/campaign/CampaignCard.test.tsx` (existing component test suites -- this is the seam the parent spec's Testing Decisions section names for this whole ticket set: a visual/CSS/markup change with no new business logic, existing route-handler and component tests are the seam, behavioral rigor must not weaken, no snapshot/visual-regression tooling). Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk: the motif rendering when `showLedgerLine` is true, the motif being absent when it is false or omitted (the default, exercised by every pre-existing test in `ProgressBar.test.tsx` which never passes the prop), the three tick positions being exactly `25%`/`50%`/`75%` regardless of `current`/`target`, and the `ledger` token not leaking onto the card's other elements (urgent badge, demo badge, amount text). Helper internal seperti `calculatePercentage` diuji secara tidak langsung lewat seam ini juga, tidak langsung, meskipun diekspor. Nilai harapan dalam test adalah literal yang diketahui (`'25%'`, `'50%'`, `'75%'`, hex string `'B8862E'`), bukan dihitung ulang dari kode.

**Facts gathered (do not re-derive):**

Current `ProgressBar.tsx` (full file, 81 lines):
```typescript
'use client';

import { useEffect, useState } from 'react';

export interface ProgressBarProps {
  /** Collected amount */
  current: number;
  /** Target amount */
  target: number;
  /** Show percentage text */
  showLabel?: boolean;
  /** Height variant */
  size?: 'sm' | 'md';
  /** Animate fill on mount */
  animated?: boolean;
}

/**
 * Calculates percentage from current and target values.
 * Never exceeds 100%, never negative.
 * Returns 0 if target is 0 or negative values are provided.
 */
export function calculatePercentage(current: number, target: number): number {
  if (target <= 0) return 0;
  if (current < 0) return 0;
  return Math.min((current / target) * 100, 100);
}

export function ProgressBar({
  current,
  target,
  showLabel = false,
  size = 'md',
  animated = false,
}: ProgressBarProps) {
  const percentage = calculatePercentage(current, target);
  const [width, setWidth] = useState(animated ? 0 : percentage);

  useEffect(() => {
    if (animated) {
      const timeout = setTimeout(() => {
        setWidth(percentage);
      }, 50);
      return () => clearTimeout(timeout);
    } else {
      setWidth(percentage);
    }
  }, [animated, percentage]);

  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div className="w-full">
      <div
        className={`w-full ${heightClass} rounded-full bg-bg-secondary overflow-hidden`}
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`${heightClass} rounded-full`}
          style={{
            width: `${width}%`,
            background: 'linear-gradient(90deg, #D97748, #D50000)',
            transition: animated ? 'width 600ms ease-in-out' : 'none',
          }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-text-secondary mt-1 block">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
}

export default ProgressBar;
```

Confirmed consumers of `ProgressBar` (grep, exhaustive, 3 call sites): `src/components/campaign/CampaignCard.tsx:129`, `src/components/campaign/CampaignDetail.tsx:157`, `src/components/campaign/CampaignDetailView.tsx:153`. Only the first opts into `showLedgerLine`; the other two are not touched by this task at all and must be re-read after the change to confirm they are textually identical to before.

Current `CampaignCard.tsx`'s progress bar call site (the exact block to change):
```tsx
<ProgressBar
  current={campaign.collectedAmount}
  target={campaign.targetAmount}
  size="sm"
  animated={false}
/>
```

**Design decision, recorded here so the reviewer doesn't flag it as an unexplained inconsistency:** the motif's colors (`#B8862E` for both the track's gradient and the tick marks) are hardcoded as inline `style` values, not a Tailwind class referencing the `ledger` token. This mirrors the *existing* pattern already in this exact file -- the fill bar's own gradient is already a hardcoded inline `background: 'linear-gradient(90deg, #D97748, #D50000)'`, not a Tailwind class -- and is required for testability: Tailwind's `theme()` function only resolves inside class strings processed by Tailwind's build-time JIT, never inside a runtime JS string handed to React's `style` prop, and jsdom (the test environment) loads no compiled CSS at all, so a Tailwind-class-only implementation would be untestable via `element.style`.

Existing `ProgressBar.test.tsx` (full file, 105 lines) -- read in full. Covers `calculatePercentage` edge cases (normal, zero current, equals target, exceeds target/caps at 100, target=0, negative current, negative target) and component behavior (aria attributes, showLabel on/off, caps displayed percentage, size classes sm/md, animated transition on/off). None of these tests assert on the fill bar's `background` inline-style value, and none pass `showLedgerLine` -- every one of them exercises the new prop's default-`false` path and must keep passing completely unmodified.

Existing `CampaignCard.test.tsx` (full file, 182 lines) -- read in full. One relevant existing test, `'renders progress bar'`, queries `container.querySelector('[role="progressbar"]')` and asserts non-null -- must keep passing unmodified (the motif must not remove or rename the `progressbar` role). No other existing test in this file touches the progress bar. This task's new tests are additions, not modifications, to this file.

`CampaignCardSkeleton.tsx`/`.test.tsx` needs no code change -- its "progress bar" placeholder is a generic `Skeleton` shimmer rectangle with no `ProgressBar` import; the ticket only requires this suite to keep passing, which it will, untouched.

`ledger` token: already defined in `tailwind.config.ts`'s `colors` block as `#B8862E` by ticket 01 (merged to `main`), consumed nowhere in the current codebase (grep-confirmed) -- this task is its first and, per the parent spec, its only consumer in this whole ticket set.

- [ ] **Step 1: Write the failing tests for `ProgressBar`'s new `showLedgerLine` capability**

Add to `src/components/ui/ProgressBar.test.tsx`, inside the existing `describe('ProgressBar component', ...)` block (do not remove or alter any existing `it(...)` in that block):

```tsx
  it('does not render Ledger Line ticks when showLedgerLine is omitted (default)', () => {
    const { container } = render(<ProgressBar current={50} target={100} />);
    expect(container.querySelectorAll('[data-testid="ledger-tick"]')).toHaveLength(0);
  });

  it('keeps the default flat track background when showLedgerLine is omitted', () => {
    render(<ProgressBar current={50} target={100} />);
    const track = screen.getByRole('progressbar');
    expect(track.className).toContain('bg-bg-secondary');
    expect(track.style.backgroundImage).toBe('');
  });

  it('renders three Ledger Line milestone ticks at fixed 25/50/75% when showLedgerLine is true', () => {
    const { container } = render(
      <ProgressBar current={50} target={100} showLedgerLine />
    );
    const ticks = container.querySelectorAll('[data-testid="ledger-tick"]');
    expect(ticks).toHaveLength(3);
    const positions = Array.from(ticks).map((tick) => (tick as HTMLElement).style.left);
    expect(positions).toEqual(['25%', '50%', '75%']);
  });

  it('keeps Ledger Line tick positions fixed at 25/50/75% regardless of current/target', () => {
    const { container } = render(
      <ProgressBar current={950} target={1000} showLedgerLine />
    );
    const ticks = container.querySelectorAll('[data-testid="ledger-tick"]');
    const positions = Array.from(ticks).map((tick) => (tick as HTMLElement).style.left);
    expect(positions).toEqual(['25%', '50%', '75%']);
  });

  it('renders the dashed gold repeating-linear-gradient track background when showLedgerLine is true', () => {
    render(<ProgressBar current={50} target={100} showLedgerLine />);
    const track = screen.getByRole('progressbar');
    expect(track.style.backgroundImage).toContain('repeating-linear-gradient');
    expect(track.className).not.toContain('bg-bg-secondary');
  });

  it('still renders the real-progress fill bar on top of the Ledger Line motif', () => {
    render(<ProgressBar current={75} target={100} showLedgerLine />);
    const track = screen.getByRole('progressbar');
    expect(track).toHaveAttribute('aria-valuenow', '75');
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/components/ui/ProgressBar.test.tsx`
Expected: the 6 new tests FAIL (`showLedgerLine` prop does not exist yet, no `data-testid="ledger-tick"` elements render). All pre-existing tests in this file still PASS (nothing has changed yet in the component).

- [ ] **Step 3: Implement `showLedgerLine` in `ProgressBar.tsx`**

Replace the full contents of `src/components/ui/ProgressBar.tsx` with:

```typescript
'use client';

import { useEffect, useState } from 'react';

export interface ProgressBarProps {
  /** Collected amount */
  current: number;
  /** Target amount */
  target: number;
  /** Show percentage text */
  showLabel?: boolean;
  /** Height variant */
  size?: 'sm' | 'md';
  /** Animate fill on mount */
  animated?: boolean;
  /**
   * Renders the Ledger Line motif on the track: a dashed gold
   * repeating-linear-gradient background plus three fixed milestone
   * ticks at 25/50/75%, independent of the real current/target values.
   * This is a promise about the platform's staged-disbursement process,
   * not a report on this specific campaign's real progress -- the real
   * progress fill bar still renders on top, unchanged. Defaults to false
   * so every existing call site renders exactly as it did before.
   */
  showLedgerLine?: boolean;
}

const LEDGER_MILESTONE_POSITIONS = [25, 50, 75] as const;

/**
 * Calculates percentage from current and target values.
 * Never exceeds 100%, never negative.
 * Returns 0 if target is 0 or negative values are provided.
 */
export function calculatePercentage(current: number, target: number): number {
  if (target <= 0) return 0;
  if (current < 0) return 0;
  return Math.min((current / target) * 100, 100);
}

export function ProgressBar({
  current,
  target,
  showLabel = false,
  size = 'md',
  animated = false,
  showLedgerLine = false,
}: ProgressBarProps) {
  const percentage = calculatePercentage(current, target);
  const [width, setWidth] = useState(animated ? 0 : percentage);

  useEffect(() => {
    if (animated) {
      // Trigger animation on mount by setting width after initial render
      const timeout = setTimeout(() => {
        setWidth(percentage);
      }, 50);
      return () => clearTimeout(timeout);
    } else {
      setWidth(percentage);
    }
  }, [animated, percentage]);

  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div className="w-full">
      <div
        className={`w-full ${heightClass} rounded-full overflow-hidden relative ${
          showLedgerLine ? '' : 'bg-bg-secondary'
        }`}
        style={
          showLedgerLine
            ? {
                backgroundImage:
                  'repeating-linear-gradient(90deg, #B8862E 0 4px, transparent 4px 8px)',
              }
            : undefined
        }
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {showLedgerLine &&
          LEDGER_MILESTONE_POSITIONS.map((position) => (
            <span
              key={position}
              data-testid="ledger-tick"
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-px"
              style={{ left: `${position}%`, backgroundColor: '#B8862E' }}
            />
          ))}
        <div
          className={`${heightClass} rounded-full relative z-10`}
          style={{
            width: `${width}%`,
            background: 'linear-gradient(90deg, #D97748, #D50000)',
            transition: animated ? 'width 600ms ease-in-out' : 'none',
          }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-text-secondary mt-1 block">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
}

export default ProgressBar;
```

- [ ] **Step 4: Run `ProgressBar.test.tsx` to verify all tests pass**

Run: `npx vitest run src/components/ui/ProgressBar.test.tsx`
Expected: all tests PASS -- the 6 new tests, and every pre-existing test unmodified.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ProgressBar.test.tsx src/components/ui/ProgressBar.tsx
git commit -m "feat: add opt-in Ledger Line motif to ProgressBar"
```

- [ ] **Step 6: Write the failing tests for `CampaignCard`'s Ledger Line usage**

Add to `src/components/campaign/CampaignCard.test.tsx`, inside the existing `describe('CampaignCard', ...)` block, immediately after the existing `'renders progress bar'` test (do not remove or alter any existing `it(...)`):

```tsx
  it('renders the Ledger Line motif with three fixed milestone ticks under the progress bar', () => {
    const { container } = render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const ticks = container.querySelectorAll('[data-testid="ledger-tick"]');
    expect(ticks).toHaveLength(3);
    const positions = Array.from(ticks).map((tick) => (tick as HTMLElement).style.left);
    expect(positions).toEqual(['25%', '50%', '75%']);
  });

  it('does not apply the ledger gold token to the urgent badge, demo badge, or collected amount', () => {
    const urgentDemoCampaign = { ...mockCampaign, isUrgent: true, isDemo: true };
    render(<CampaignCard campaign={urgentDemoCampaign} variant="standard" />);
    const urgentBadge = screen.getByText('DARURAT');
    const demoBadge = screen.getByText('Kampanye contoh');
    const amount = screen.getByText('Rp25.841.000');
    [urgentBadge, demoBadge, amount].forEach((el) => {
      expect(el.className).not.toMatch(/ledger/i);
      expect((el as HTMLElement).style.backgroundImage || '').not.toContain('B8862E');
      expect((el as HTMLElement).style.backgroundColor || '').not.toContain('B8862E');
      expect((el as HTMLElement).style.color || '').not.toContain('B8862E');
    });
  });
```

This file's top imports `{ render, screen, cleanup, fireEvent }` from `@testing-library/react` already -- `screen` is already available, no new import needed.

- [ ] **Step 7: Run the new tests to verify they fail**

Run: `npx vitest run src/components/campaign/CampaignCard.test.tsx`
Expected: the first new test FAILS (no ticks render yet, `CampaignCard` doesn't pass `showLedgerLine`). The second new test PASSES already (there is no ledger usage yet at all) -- that is expected and fine; it becomes a real regression guard once Step 8 adds the motif. All pre-existing tests still PASS.

- [ ] **Step 8: Wire `CampaignCard.tsx` to opt into the motif**

In `src/components/campaign/CampaignCard.tsx`, change the `<ProgressBar>` call (currently at line 129):

```tsx
          <ProgressBar
            current={campaign.collectedAmount}
            target={campaign.targetAmount}
            size="sm"
            animated={false}
          />
```

to:

```tsx
          <ProgressBar
            current={campaign.collectedAmount}
            target={campaign.targetAmount}
            size="sm"
            animated={false}
            showLedgerLine
          />
```

No other line in `CampaignCard.tsx` changes.

- [ ] **Step 9: Run `CampaignCard.test.tsx` to verify all tests pass**

Run: `npx vitest run src/components/campaign/CampaignCard.test.tsx`
Expected: all tests PASS -- both new tests, and all 19 pre-existing tests unmodified.

- [ ] **Step 10: Verify `CampaignDetail.tsx` and `CampaignDetailView.tsx` are untouched**

Run: `git diff --stat src/components/campaign/CampaignDetail.tsx src/components/campaign/CampaignDetailView.tsx`
Expected: no output (empty diff) -- confirms this task did not modify either file, and their `<ProgressBar>` call sites still omit `showLedgerLine`, so they keep rendering the plain flat two-tone bar exactly as before.

- [ ] **Step 11: Run the full test suite**

Run: `npx vitest run`
Expected: all test files PASS, including the two modified files and every other suite in the repo (this change touches no other file).

- [ ] **Step 12: Manual browser verification**

Start the dev server (`npm run dev`) and visit a page that renders `CampaignCard` (the homepage's campaign carousels, or `/explore/all`). Confirm, at a range of real progress percentages (a campaign near 0%, one past 75%, one that has met its target):
- The dashed gold Ledger Line and its three ticks render under the progress bar, at fixed 25/50/75% positions regardless of that campaign's actual percentage.
- The real progress fill (orange-to-red gradient) still renders correctly on top, reflecting the true collected percentage.
- No other element on the card (badges, buttons, text) picks up the gold color.

If the dev environment has no seeded campaigns or another blocker prevents visiting a real listing page, read the compiled/rendered output via the component test suite's DOM output as a documented substitute, and note the blocker explicitly in the task report -- do not silently skip this verification.

- [ ] **Step 13: Commit**

```bash
git add src/components/campaign/CampaignCard.tsx src/components/campaign/CampaignCard.test.tsx
git commit -m "feat: apply the Ledger Line motif to CampaignCard's progress bar"
```
