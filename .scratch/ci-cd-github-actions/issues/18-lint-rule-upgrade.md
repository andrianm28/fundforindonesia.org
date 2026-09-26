# 18: Promote the new eslint-config-next 16 rules from warn to error

**What to build:** Ticket 15's Next 16 upgrade brought in four ESLint rules
that the old `.eslintrc.json` never enforced at all:
`react-hooks/set-state-in-effect`, `react-hooks/immutability` and
`react-hooks/purity` (all from `react-hooks@7`'s React Compiler-oriented rule
set), plus a stricter default for `@next/next/no-html-link-for-pages`. Ticket
15 set all four to `warn` in `eslint.config.mjs` rather than either dropping
them or leaving them as blocking errors mid-upgrade (they currently fire on a
handful of files: 10 `set-state-in-effect`, 2 `immutability`, 2 `purity`, 1
`no-html-link-for-pages`).

Fix the flagged spots, then promote each rule back to `'error'` in
`eslint.config.mjs`, and lower `ci/baselines.json`'s `lint` count once
`eslint . --format json` reports fewer errors after the fix (it will only go
lower here, since the rules were `warn` and not counted before).

**Blocked by:** 15 (must merge first; this ticket's baseline math depends on
ticket 15's `eslint.config.mjs` and `ci/baselines.json`)

**Status:** ready-for-agent

- [ ] All four rules read `'error'` in `eslint.config.mjs`, not `'warn'`
- [ ] `eslint .` reports zero findings for these four rules
- [ ] `ci/baselines.json`'s `lint` count reflects the new, lower total (never raised)
- [ ] CI is green: test, build, migrations, ratchet
