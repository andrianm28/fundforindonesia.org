# 21: Upgrade framer-motion 12 to 13 (Dependabot #14)

**What to build:** `framer-motion` ^12.42.2 is used in about 19 files under
`src/`. Upgrade to 13 (checking its changelog for renamed APIs and the `motion`
package split), fix any breaking usage, and close Dependabot PR #14 in favour
of this one.

**Blocked by:** 15 (React 19 comes with the Next 16 upgrade; framer-motion 13 targets it)

**Status:** in-review (PR #168)

- [ ] `framer-motion` 13.x (or the successor package the changelog names), one copy in `npm ls`
- [ ] Every animated component still renders; the tests that mount them pass
- [ ] CI green; Dependabot #14 is closed with a pointer to this PR
