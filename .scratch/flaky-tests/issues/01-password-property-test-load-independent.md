# 01: The password property tests pass under any machine load

**What to build:** "Property 3: Password Security" in `src/__tests__/properties/api-validation.property.test.ts` timed out (30 s) in most full suite runs on 2026-09-25 whenever the machine was busy, yet it always passed on its own.

Diagnosis (`/diagnosing-bugs`):
- The loop pins the test to one CPU shared with N busy loops.
- At cost 10 it goes red with N=4, on both tests.
- With the test's stored hash at cost 4 and N=4, both tests are green.
- At N=8 the "correct password" test is red again, because the route hashes the new password with a hard-coded cost 10.

So the tests are CPU-bound on production bcrypt cost factors they cannot control. Ticket 40 (`prd-compliance-fase-0-2`) will raise the cost to 12, about 4x the work, which would make them worse.

Fix:
- Password hash cost factors move to one module. Registration stays at 12 and password change at 10: values unchanged, so this is the "single place" half of ticket 40, not its decision.
- The routes read the cost from that module.
- The property tests set a low cost (4) through that module and keep real bcrypt, so a wrong password is still genuinely rejected.
- A regression test asserts the route hashes at the configured cost.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Registration and password change take their cost from one module; production values unchanged (12 and 10)
- [ ] The property tests run real bcryptjs at cost 4 via that module, and assert (bcrypt.getRounds) that both the stored hash and the new hash use it
- [ ] The diagnosis loop (one CPU shared with 8 busy loops) is green for both tests
- [ ] Full suite green, tsc adds no errors. Ticket 40 gets a note that its single place now exists
