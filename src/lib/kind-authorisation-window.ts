/**
 * How many days before a Kind Authorisation's `validTo` its Partner
 * Organisation is warned (CONTEXT.md, Kind Authorisation). Per spec.md
 * ("Kind Authorisation expiry warnings at 30 days"), the same horizon the
 * Verifier's "expiring soon" lists use (expiringWindows in
 * ./collecting-entity.ts, kindAuthorisationsNeedingRenewal in
 * ./kind-authorisation-renewal.ts). Kept in this database-free module so
 * both the scheduled warning (./reminders.ts) and the list read one value.
 */
export const KIND_AUTHORISATION_EXPIRY_WARNING_DAYS = 30;
