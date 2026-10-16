# 03: Drop the Role and self-verification columns

**What to build:** A migration that drops `User.role`, `User.isVerified`, `User.verificationType` and the `Role` enum. It deploys only after ticket 02 is live in production, so a code rollback still works.

**Blocked by:** 02, plus confirmation that ticket 02 is live in production

**Status:** done

- [x] Ticket 02 confirmed live in production
- [x] The drop migration is written, applied to a Postgres at the ticket-02 state, and `migrate diff` is empty
- [x] The schema no longer declares the columns or the enum. Full suite green

## Comments

- 2026-09-26 (from ticket 02): The Role route module is deleted, so it answers 404, not 405; the guard pins that it is gone. Also:
  - delete the canary `tests/support/user-role-canary.ts` and the column checks in `src/__tests__/user-role-readers.test.ts`;
  - update the register-route test fixtures, which list the retired columns as null;
  - update `roles-backfill.test.ts`, which reads the old backfill SQL naming `role`.

  The middleware and property tests use a local role type and survive the enum drop.

- 2026-10-10 (rilis-1 62): done. Migration `20261010020000_drop_user_role_columns` drops the three columns and the `Role` enum; replayed over a User row holding `role = ADMIN`, `migrate diff` empty. The canary and the typed half of `user-role-readers.test.ts` are deleted (the by-name guard over application code stays), replaced by `user-role-dropped.test.ts`. `roles-backfill.test.ts` only reads the old backfill SQL as text and needed no change.
