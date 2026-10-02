/**
 * The bcrypt cost factor every password on this platform is hashed at, in one
 * place, so no route hard-codes its own and tests can lower it without mocking
 * bcrypt away. See ADR 0017.
 *
 * The number is 12. Registration has always hashed at 12 and a password change
 * at 10, so the act of rotating a password permanently *downgraded* that
 * account — the security-conscious user who rotates was the one who lost
 * strength. 12 is the stronger of the two and the one bcrypt's own guidance
 * centres on, so unifying on it can only ever raise a hash. Ticket 41
 * re-measures what 12 costs in latency on this hardware; that is a tuning
 * change to this line, not a second decision to make.
 */
export const PASSWORD_HASH_COST = 12;

/**
 * Whether a stored hash was already produced at `PASSWORD_HASH_COST`.
 *
 * bcrypt writes its cost into the hash's own `$2a$NN$` prefix, so the factor is
 * read back off the stored string instead of being kept in a column beside it.
 * There is no second source of truth to drift out of sync, and accounts that
 * were weakened before this existed need no migration: their hash already
 * carries the answer.
 *
 * A factor we cannot read — a hash from another scheme, a truncated string, an
 * empty one — counts as not current, so the caller re-hashes it while it still
 * holds the plaintext rather than leaving it weak forever.
 */
export function isHashAtCurrentCost(storedHash: string): boolean {
  const match = /^\$2[abxy]\$(\d{2})\$/.exec(storedHash);

  return match !== null && Number(match[1]) === PASSWORD_HASH_COST;
}
