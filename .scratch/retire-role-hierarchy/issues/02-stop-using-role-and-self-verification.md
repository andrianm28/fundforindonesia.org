# 02: Nothing reads or writes Role, isVerified or verificationType

**What to build:**
- Delete `roles.ts`, `withRoleCheck` and the middleware's `ROLE_LEVELS`.
- Delete the Role route and the Role editor under `/admin/users`, including the "cannot remove ADMIN from yourself" check, and keep the assignments editor.
- Drop `role` from the session, JWT and `next-auth.d.ts`.
- Stop sending `creator.isVerified` or any self-claimed verification field in payloads.
- The Admin user list shows assignments.
- An additive migration makes `role`, `isVerified` and `verificationType` nullable with no defaults. Verify it on a throwaway Postgres, with `migrate diff` empty.
- The seed stops writing them.

See `.scratch/retire-role-hierarchy/spec.md`.

**Blocked by:** 01

**Status:** done

- [ ] No `src` or seed code names `role`, `isVerified` or `verificationType` on User; a static guard proves it
- [ ] The Admin user page manages assignments only; the Role route is gone (405)
- [ ] Public payloads carry no `isVerified`
- [ ] The migration is applied to a fresh Postgres, and `migrate diff` is empty. Full suite green, tsc adds no errors
