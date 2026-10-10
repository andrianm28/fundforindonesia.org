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

// The Campaign the Flag-then-dismiss spec (flag-dismiss.spec.ts) works on:
// the same Active fixture the donation specs use, which a Flag leaves
// untouched (raising and dismissing one changes nothing about the Campaign).
export const ACTIVE_CAMPAIGN_ID = 'e2e-campaign-aktif';

// Two operators who are not that Campaign's Fundraiser, one per assignment.
// The password is a throwaway for this job's throwaway database, hashed by
// the seed; there is no passwordless session fixture, so the spec signs in
// through NextAuth's own credentials endpoint with it.
export const VERIFIER_EMAIL = 'e2e-verifier@example.org';
export const ADMIN_EMAIL = 'e2e-admin@example.org';
export const OPERATOR_PASSWORD = 'e2e-sandi-bukan-rahasia';
