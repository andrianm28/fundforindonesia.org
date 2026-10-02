---
status: accepted
---

# Password hashing on a native binding (`@node-rs/bcrypt`), not pure-JS bcryptjs

bcryptjs hashes on the single Node thread. At the production cost (12, ADR 0017) a burst of 50 concurrent logins stalled the event loop for about 10 s in the ticket's 8-core measurement, so donation pages, payment webhooks and health checks all hung behind it. We hash and verify with `@node-rs/bcrypt` instead: bcrypt in Rust, run on the libuv threadpool. All callers go through `src/lib/password-hash.ts` (`hashPassword`, `verifyPassword`); the cost stays `PASSWORD_HASH_COST` = 12.

## Considered options

- `@node-rs/bcrypt` (chosen). N-API, prebuilt binaries published as optional per-platform packages, including `linux-x64-musl` and `linux-arm64-musl`, so the Alpine image needs no compiler, python or node-gyp. The `.node` file for musl is about 0.56 MB and links only `libc.so`.
- `bcrypt` (node.bcrypt.js). Also native and threadpooled, but it fetches its prebuilt binary in an install script (`node-pre-gyp`/`prebuild-install`) and falls back to compiling with node-gyp when none matches. That is a network call and a possible toolchain at build time, in the one place we want neither.
- Keep bcryptjs and offload to `worker_threads`. Rejected: we would own a worker pool for something a maintained binding already does.
- Keep bcryptjs as a runtime fallback. Rejected: a silent fallback would bring the stall back without anyone noticing. A binding that fails to load should fail the build or the boot loudly. bcryptjs stays as a **devDependency** only, so `src/lib/password-hash.test.ts` can prove both directions of compatibility with real hashes.

## Consequences

- No migration, no reset. The stored format is unchanged: `$2a$`/`$2b$` prefix with the cost in it. The binding verifies every existing bcryptjs hash and bcryptjs verifies what the binding writes (so a rollback is also safe); `password-hash.test.ts` runs both directions on real hashes, including cost 12.
- `isHashAtCurrentCost` no longer needs a library: it reads `$2x$NN$` with a regex, and anything unreadable still counts as not current (ADR 0017).
- Build constraint, the real trade of this decision: the app now depends on a platform-specific binary. `npm ci` picks the optional package matching the machine's libc, so the Alpine (musl) Docker build gets `@node-rs/bcrypt-linux-*-musl` and a glibc CI runner gets the `-gnu` one. Both are pinned in `package-lock.json`. Next's standalone tracing copies the binary that was installed, so the image carries only the musl one. Building on one libc and running on another would break; the Dockerfile installs and runs on the same base image, so it does not.
- Verification of the musl build: done in a real Docker build of the `Dockerfile` on `node:24-alpine` (Alpine 3.24). `npm ci` installed `@node-rs/bcrypt-linux-x64-musl`, `next build` traced it into `.next/standalone`, the runner-stage smoke test passed as the `nextjs` user, a cost-12 hash/verify round trip worked inside the image, and the container started and served `/`. Not covered: linux-arm64-musl (lockfile pins it, never loaded) and a login against a real database. CI still builds the image on every push.
- `verifyPassword` returns false for a stored value that is not a bcrypt hash instead of throwing, and nothing in this path logs a password or a hash. The digest comparison is the binding's own.
- Event-loop lag, 50 concurrent cost-12 verifications, this change's 4-vCPU container (shared with other jobs, so absolute numbers are pessimistic): bcryptjs 2.1/s with 5184 ms worst lag; `@node-rs/bcrypt` 3.6/s with 142 ms worst lag. The remaining lag is CPU contention, not the main thread being blocked.
- libuv threadpool: left at the default 4, and not raised in code. The work is CPU-bound, so threads beyond the core count add nothing. The ticket's 9.6/s to 11.1/s plateau was four threads on eight cores; on the production host, set `UV_THREADPOOL_SIZE` to its core count in the container environment if login throughput ever matters. That is an ops setting for the owner, not a code change.
