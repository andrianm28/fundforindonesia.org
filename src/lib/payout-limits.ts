/**
 * Length caps on what a Fundraiser writes on a Payout request. One place, so
 * the route's zod schemas and the money layer (src/lib/money/payouts.ts)
 * cannot drift apart.
 */
export const MAX_PAYOUT_DESCRIPTION_LENGTH = 500;
export const MAX_PAYOUT_NOTE_LENGTH = 1000;
