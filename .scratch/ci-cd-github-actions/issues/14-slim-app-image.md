# 14: Slim the production app image

**What to build:** The app image is about 2.35 GB. The image job needed a disk-freeing step, and the host has to pull it on every deploy. Make it smaller using the standalone output: only runtime deps, no dev deps or build caches, sharp prebuilt for the target. Measure before and after.

**Blocked by:** None

**Status:** done (PR #29, cf1e758)

- [ ] The image size is reported before and after, with a clear reduction
- [ ] The image job's smoke tests (migrate, `/api/health`) and Trivy still pass

- 2026-09-26 (after merge): the app image went from 974 MiB to 220 MiB uncompressed (-77%), and migrate is 388 MiB. sharp is pinned at 0.35.4 via `NEXT_SHARP_PATH`, and cd.yml smoke-tests it. Follow-up: the "Free runner disk space" step in cd.yml may no longer be needed.
