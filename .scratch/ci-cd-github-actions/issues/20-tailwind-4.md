# 20: Upgrade Tailwind CSS 3 to 4 (Dependabot #13)

**What to build:** `tailwindcss` is at ^3.4.1 with `tailwind.config.ts` and
`postcss.config.mjs`. Tailwind 4 moves configuration into CSS (`@theme`), ships
its own PostCSS plugin (`@tailwindcss/postcss`) and renames or drops some
utilities. Upgrade with the official migration tool, keep the design tokens,
and close Dependabot PR #13 in favour of this one.

**Blocked by:** 15 (land the Next major first; one framework shift at a time)

**Status:** ready-for-agent

- [ ] `tailwindcss` 4.x with `@tailwindcss/postcss`; the design tokens from `tailwind.config.ts` live on (in CSS `@theme` or a kept JS config, decision recorded in the PR)
- [ ] No utility used in `src/` is silently dropped: `npx next build` succeeds, and a before/after screenshot of the home page, a Campaign page and the Admin shell shows no visual regression
- [ ] Component tests that assert class names still pass
- [ ] CI green; Dependabot #13 is closed with a pointer to this PR
