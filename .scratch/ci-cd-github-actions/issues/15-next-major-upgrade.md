# 15: Upgrade Next.js to a release that fixes GHSA-2xp9-vwfh-vxw4

**What to build:** The app runs next 14.2.35, which carries a CRITICAL remote
code execution in the image optimizer (sharp/libheif, AVIF input,
GHSA-2xp9-vwfh-vxw4). Ticket 13 closed the path with a stopgap:
`images.unoptimized: true` in `next.config.mjs`, so `/_next/image` answers 404,
pinned by `src/__tests__/next-config-images.test.ts`. Trivy still reports the
advisory by package version, and `.trivyignore` mutes it only until
**2026-10-10**. After that date the `image` job in `cd.yml` fails again until
this ticket lands.

Upgrade `next` (and `eslint-config-next`) to a fixed release: **15.5.24+** or
**16.3.3+**. Pick one line and do the migration work it implies, for example:

- React 19 and the matching `react-dom`, `@types/react` and testing-library versions
- async request APIs (`cookies()`, `headers()`, `params`, `searchParams` become Promises)
- changed fetch/route caching defaults (GET route handlers and `fetch` are no longer cached by default in 15)
- `next-auth` compatibility with the chosen Next/React versions
- `next.config.mjs` options renamed or removed, and `output: 'standalone'` still producing the image the Dockerfile expects

Then decide whether to turn the image optimizer back on. If you do, replace
`unoptimized` with a `remotePatterns` allowlist that has no wildcard host, and
update the config test to match. Cover images accept any https URL today, so
turning it back on also means limiting where cover images may come from, or
proxying them.

**Blocked by:** 13 (stopgap, PR #21). This must merge before 2026-10-10
or the `.trivyignore` expiry turns the `image` job red.

**Status:** in review (PR #41)

- [ ] `next` is at 15.5.24+ or 16.3.3+, and `npm ls next` shows no older copy
- [ ] CI is green: test, build, migrations, ratchet, image (Trivy no longer reports GHSA-2xp9-vwfh-vxw4)
- [ ] The `GHSA-2xp9-vwfh-vxw4` entry is removed from `.trivyignore`, and `CVE-2026-75604` is re-checked and removed if the new version fixes it
- [ ] Every image the app shows still renders (covers, avatars, uploads), and the image-optimizer decision is recorded in `next.config.mjs` and pinned by a test
