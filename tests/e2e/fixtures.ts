/**
 * Shared constants for the e2e specs and their seed (seed-e2e.ts).
 * Import-free on purpose: spec files are loaded by Playwright before any
 * database exists, so they must not transitively import the generated
 * Prisma client — only the seed may.
 */
export const ACTIVE_SLUG = 'e2e-qris-aktif';
export const DRAFT_SLUG = 'e2e-draft-tersembunyi';
export const RECEIPT_TOKEN = 'e2e-receipt-token-0001';
export const RECEIPT_AMOUNT = 75_000;
