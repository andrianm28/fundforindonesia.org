---
status: accepted
---

# One bcrypt cost factor for every password, and weakened accounts repaired on login

Registration hashed at 12 and a password change re-hashed at 10. Both numbers date to the initial commit, so this is not a regression, only a design that was never right: rotating a password permanently *weakened* that account, and the security-conscious user who rotated was the one who paid for it. We keep one factor, 12, and use it everywhere.

## Considered options

- One factor, 10. Rejected: it would make the fix trivially small, but it lowers every existing account rather than raising the weakened ones, and 12 is the factor bcrypt's own guidance centres on. Making the number smaller to keep latency down is ticket 41's job, and it can be done on this one line.
- Store the cost factor in its own column next to the hash. Rejected: bcrypt already writes the factor into the hash's own `$2a$NN$` prefix, so a second source of truth can only drift out of sync with the hash it describes, and it would need a migration and a backfill for rows that do not need either.
- Leave the weakened accounts alone, on the grounds that a migration is out of scope. Rejected: the accounts already exist and are already weak; the fix is the login, not a migration, because a successful credential login is the one moment the plaintext is in hand and cannot be recovered later.
- Re-hash inside the request path or in a session callback. Rejected: both run per request rather than per login, so they would add a write to every authenticated request. The credentials provider's `authorize` runs only on an actual sign-in.

## Consequences

- The factor lives in `src/lib/password-hash-cost.ts` as `PASSWORD_HASH_COST`. No route, seed script, or fixture writes a number; the only production calls to `bcrypt.hash` are registration, password change, and the login repair, and all three read it.
- A successful login whose stored hash reads below the current factor re-hashes it, best-effort, and lets the user in either way. Failing to upgrade a hash must never cost someone their login, so the write is wrapped and logged rather than allowed to reject. Accounts that were never weakened are untouched: the repair writes nothing, and it never runs off the request path.
- Raising the factor to 13 later makes every stored 12 a weakened account, and they get repaired on their next login, one write each, spread over however long users take to sign in again. That is the intended behaviour of a rotation, and it is why the constant is a single line that can move.
- Lowering the constant has the opposite effect and is a downgrade of every account, at their next login. Nothing in the code stops it, because "below the current factor" is the only test the repair can make without a second column to compare against. So the number is changed in review as a security decision, not as tuning; ticket 41 measures latency to inform that decision rather than to enable a quiet reduction.
