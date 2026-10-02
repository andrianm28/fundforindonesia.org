# 41: Password hashing must stop stalling the whole server

**What to build:** Authentication stops being able to freeze the entire application. Today password hashing runs in pure JavaScript on the single Node thread, so a burst of logins blocks every other request — donation pages, payment webhooks, health checks — for as long as the burst lasts. After this ticket, hashing runs off the main thread and concurrent logins no longer make the rest of the site wait.

**Blocked by:** None (can start immediately)

**Status:** awaiting-merge

- [x] Password hashing and verification no longer occupy the main thread
- [x] Existing stored hashes keep working with no password reset and no migration, because the hash format is unchanged
- [x] Proven inside the real deployment image, not only on a developer machine: the current base image is Alpine (musl libc) while the benchmarks below ran on glibc, and native bindings are libc-specific
- [x] The Docker build still succeeds and the image still starts
- [x] A recorded measurement of event-loop lag under concurrent logins, before and after, so the improvement is evidence rather than belief
- [x] An ADR records the choice: a native binding trades "pure JS works everywhere" for platform-specific binaries in the build, which is a real constraint for a Dockerised deploy
- [x] Consider whether the libuv threadpool size needs raising, since throughput barely improved from 10 to 50 concurrent operations (9.6/s to 11.1/s), which is the default four threads saturating

**Measured locally** (8 cores, Node 22, glibc), 50 concurrent cost-12 verifications:

| implementation | throughput | worst event-loop lag |
| --- | --- | --- |
| bcryptjs (pure JS, current) | 2.2/s | 10079ms |
| @node-rs/bcrypt (Rust, threadpool) | 11.1/s | 5ms |

Cross-compatibility was verified in both directions: the native implementation reads bcryptjs hashes and bcryptjs reads native hashes, which is what makes this a drop-in swap rather than a migration.

**Why this matters beyond speed:** PRD section 9 requires the platform to hold 500 concurrent donations without failure and states that the payment queue must not block the page. A ten-second event-loop stall from a login burst violates both, and it would present as the whole site hanging rather than as a slow login, which makes it hard to diagnose in production.

**Parent spec:** `.scratch/prd-compliance-fase-0-2/spec.md`

- 2026-10-02: `@node-rs/bcrypt` via `src/lib/password-hash.ts`, ADR 0019. Compat tested both directions with real hashes (cost 4 and 12). Event-loop lag 5184ms -> 142ms (4 vCPU, shared). Threadpool left at default. Docker build now run for real (2026-10-02, dockerd in the cloud session, node:24-alpine): image builds, musl binary traced into standalone, smoke test passes, container starts and serves `/`. ADR 0019 number kept: main deliberately skipped 0019 for this ADR (commit bc97971), so there is no clash. Added a test for hashes at older costs (4, 8, 10).
