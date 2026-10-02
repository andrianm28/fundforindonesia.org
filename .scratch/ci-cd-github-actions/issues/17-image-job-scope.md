# 17: Run the image job only when it can change

**What to build:** The `image` job in `cd.yml` builds and Trivy-scans the
Docker image on every PR, about 5 minutes each, even for docs-only changes.
Run it on `main`, and on PRs only when the Dockerfile, dependencies
(`package.json`, `package-lock.json`), `prisma/`, `public/`,
`next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`, `tailwind.config.*`,
`.trivyignore` or the workflows change. `src/` is deliberately excluded
(covered by the `build` job in ci.yml and the image build on push to `main`). Priority: low (the repo is public, so
minutes are free; this saves time, not money).

**Blocked by:** 15 (avoid conflicting edits to `cd.yml` and `.trivyignore`)

**Status:** done (PR #159, cd404d5)

- [x] A docs-only PR skips `image`; a PR touching any path above runs it; every push to `main` runs it
- [x] Skipping never blocks a merge: a skipped `image` still reports a passing (or neutral) status
- [x] The deploy path (CD on `main`) is unchanged
