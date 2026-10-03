# 20: Upgrade Tailwind CSS 3 to 4 (Dependabot #13)

**What to build:** `tailwindcss` is at ^3.4.1 with `tailwind.config.ts` and
`postcss.config.mjs`. Tailwind 4 moves configuration into CSS (`@theme`), ships
its own PostCSS plugin (`@tailwindcss/postcss`) and renames or drops some
utilities. Upgrade with the official migration tool, keep the design tokens,
and close Dependabot PR #13 in favour of this one.

**Blocked by:** 15 (land the Next major first; one framework shift at a time)

**Status:** awaiting-merge

- [x] `tailwindcss` 4.x with `@tailwindcss/postcss`; the design tokens from `tailwind.config.ts` live on (in CSS `@theme` or a kept JS config, decision recorded in the PR)
- [ ] No utility used in `src/` is silently dropped: `npx next build` succeeds, and a before/after screenshot of the home page, a Campaign page and the Admin shell shows no visual regression
- [x] Component tests that assert class names still pass
- [ ] CI green; Dependabot #13 is closed with a pointer to this PR

## Comments

- 2026-10-02, branch `claude/ci-cd-20-tailwind-4`: ran `npx @tailwindcss/upgrade`
  (tailwindcss ^4.3.3, `@tailwindcss/postcss`, `postcss.config.mjs` updated,
  lockfile by npm). Decision: tokens moved into CSS `@theme` in
  `src/styles/globals.css`; `tailwind.config.ts` deleted (screens with 1025px
  `lg`, colors incl. ledger-line, radii, shadows, durations, shimmer keyframes).
  The original `:root` block was kept verbatim (the tool had wrapped it in
  `@layer utilities`; moved back out). Added two v3 preflight compat rules
  (pointer cursor on buttons, gray-400 placeholder) next to the tool's
  border-color compat rule. Fixed the tool's false rename in `LazyImage.tsx`
  (`placeholder="blur"` became `blur-sm`, a tsc error). Rename pass reviewed:
  `shadow-sm`->`shadow-xs`, `outline-none`->`outline-hidden`, hex arbitrary
  values -> theme tokens, 5 test files updated. `rounded-sm/md/lg` stay the
  custom 8/12/16px because `--radius-*` is in `@theme`.
- Evidence: `next build` ok; `vitest run src/components src/app` 204 files pass;
  ratchet lint 193 / tsc 19 (baseline). Screenshots before/after on 8 pages x 2
  widths with no DB (static/empty-state renders only, so Campaign and Admin
  were not exercised with data): pixel-identical except the home hero headline
  ~2px higher at 1280 (0.7% of pixels) and 121 px on /zakat. CI green and a
  visual check with real data are still open.
- Dependabot #13 not closed by the agent; coordinator/owner closes it with a
  pointer to the PR after merge.
