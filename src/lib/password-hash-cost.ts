/**
 * The bcrypt cost factors, in one place, so no route hard-codes its own and
 * tests can lower them without mocking bcrypt away.
 *
 * The two values differ on purpose, for now: registration has always hashed
 * at 12 and a password change at 10. Ticket 40 (prd-compliance-fase-0-2)
 * decides the single factor both should use and re-hashes weakened accounts
 * on login; until then these keep today's behaviour exactly.
 */
export const REGISTRATION_HASH_COST = 12;
export const PASSWORD_CHANGE_HASH_COST = 10;
