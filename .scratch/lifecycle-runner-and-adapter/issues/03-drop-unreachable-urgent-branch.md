# 03: Drop the unreachable concurrent-change branch in setUrgent

**What to build:** Since ticket 01, every lifecycle command holds the Campaign row lock before reading. `setUrgent` still writes with an `updateMany` predicated on the status and the flag, followed by a zero-rows → `ConcurrentTransitionError` branch. Under the lock that branch cannot be reached. The route test that exercised it by scripting a write inside the held lock (a schedule Postgres would not allow) was removed in ticket 02. Per the spec ("claim branches the lock makes unreachable are deleted"), turn the Urgent write into a plain update of the locked row and delete the branch. Nothing else about Urgent changes: same-state requests still write nothing, and "another Admin flipped the flag before our lock was granted" still results in no change and a single log row.

**Blocked by:** 01, 02

**Status:** done

- [ ] The Urgent write no longer carries a predicate or a zero-rows branch, and no test scripts a write inside the held lock
- [ ] The existing "committed before our lock" Urgent test still passes, alongside the rest of the Urgent tests
- [ ] The urgent single-writer guard, full suite and tsc stay green
