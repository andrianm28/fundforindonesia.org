# 41: Password hashing must stop stalling the whole server

**What to build:** Authentication stops being able to freeze the entire application. Today password hashing runs in pure JavaScript on the single Node thread, so a burst of logins blocks every other request — donation pages, payment webhooks, health checks — for as long as the burst lasts. After this ticket, hashing runs off the main thread and concurrent logins no longer make the rest of the site wait.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Password hashing and verification no longer occupy the main thread
- [ ] Existing stored hashes keep working with no password reset and no migration, because the hash format is unchanged
- [ ] Proven inside the real deployment image, not only on a developer machine: the current base image is Alpine (musl libc) while the benchmarks below ran on glibc, and native bindings are libc-specific
- [ ] The Docker build still succeeds and the image still starts
- [ ] A recorded measurement of event-loop lag under concurrent logins, before and after, so the improvement is evidence rather than belief
- [ ] An ADR records the choice: a native binding trades "pure JS works everywhere" for platform-specific binaries in the build, which is a real constraint for a Dockerised deploy
- [ ] Consider whether the libuv threadpool size needs raising, since throughput barely improved from 10 to 50 concurrent operations (9.6/s to 11.1/s), which is the default four threads saturating

**Measured locally** (8 cores, Node 22, glibc), 50 concurrent cost-12 verifications:

| implementation | throughput | worst event-loop lag |
| --- | --- | --- |
| bcryptjs (pure JS, current) | 2.2/s | 10079ms |
| @node-rs/bcrypt (Rust, threadpool) | 11.1/s | 5ms |

Cross-compatibility was verified in both directions: the native implementation reads bcryptjs hashes and bcryptjs reads native hashes, which is what makes this a drop-in swap rather than a migration.

**Why this matters beyond speed:** PRD section 9 requires the platform to hold 500 concurrent donations without failure and states that the payment queue must not block the page. A ten-second event-loop stall from a login burst violates both, and it would present as the whole site hanging rather than as a slow login, which makes it hard to diagnose in production.

**Parent spec:** `.scratch/prd-compliance-fase-0-2/spec.md`
