/**
 * Shared constants for the e2e specs and their seed (seed-e2e.ts).
 * Import-free on purpose: spec files are loaded by Playwright before any
 * database exists, so they must not transitively import the generated
 * Prisma client — only the seed may.
 */
export const ACTIVE_SLUG = 'e2e-qris-aktif';
export const DRAFT_SLUG = 'e2e-draft-tersembunyi';
export const CATEGORY_SLUG = 'e2e-kategori';
export const RECEIPT_TOKEN = 'e2e-receipt-token-0001';
export const RECEIPT_AMOUNT = 75_000;

// The Campaign the Flag-then-dismiss spec (flag-dismiss.spec.ts) works on:
// the same Active fixture the donation specs use, which a Flag leaves
// untouched (raising and dismissing one changes nothing about the Campaign).
export const ACTIVE_CAMPAIGN_ID = 'e2e-campaign-aktif';

// Two operators who are not that Campaign's Fundraiser, one per assignment.
// There is no passwordless session fixture, so the spec signs in through
// NextAuth's own credentials endpoint. Their password is never written in the
// repository: the CI job draws a random one into E2E_OPERATOR_PASSWORD before
// seeding, and the seed and the spec both read it from there (locally, export
// any value of 16 characters or more before running either). An Admin with a
// published password would be a standing risk the day the seed met a database
// other than the job's throwaway one; seed-e2e.ts also refuses to run unless
// E2E_THROWAWAY_DATABASE=1 and the database is on this machine.
export const VERIFIER_EMAIL = 'e2e-verifier@example.org';
export const ADMIN_EMAIL = 'e2e-admin@example.org';

export function operatorPassword(): string {
  const value = process.env.E2E_OPERATOR_PASSWORD;
  if (!value || value.length < 16) {
    throw new Error('E2E_OPERATOR_PASSWORD must be set (16+ characters) for the e2e seed and specs.');
  }
  return value;
}

// Ticket 64: a Fundraiser who can sign in, with a Campaign waiting on a
// Verifier, and a signed-in stranger who must not see its documents.
export const DOCUMENT_CAMPAIGN_ID = 'e2e-campaign-dokumen';
export const DOCUMENT_SLUG = 'e2e-dokumen-diajukan';
export const DOCUMENT_FUNDRAISER_EMAIL = 'e2e-doc-fundraiser@example.org';
export const STRANGER_EMAIL = 'e2e-stranger@example.org';

// Tickets 72, 65: a Fundraiser who can sign in, with a Draft of their own to
// edit on /akun/kampanye-saya/[slug]. STRANGER_EMAIL must get a 404 there.
export const EDIT_SLUG = 'e2e-draft-edit';
export const EDIT_FUNDRAISER_EMAIL = 'e2e-edit-fundraiser@example.org';

// Kabar Terbaru (ticket 70): an Active Campaign whose Fundraiser can sign in
// and write an update, then read it on the public page.
export const KABAR_SLUG = 'e2e-kabar-aktif';
export const KABAR_FUNDRAISER_EMAIL = 'e2e-kabar-fundraiser@example.org';

// Tim CSR accounts (ticket E9/01 tahap 2): two companies, each with a member
// whose email is verified and on the company's domain, and one Inquiry each.
// A person who registers during the spec on Alpha's domain joins Alpha but,
// with an unverified address, must still see nothing of it.
export const CSR_PROGRAM_SLUG = 'e2e-program-csr';
export const CSR_ALPHA_DOMAIN = 'e2e-alpha.example';
export const CSR_ALPHA_EMAIL = `csr@${CSR_ALPHA_DOMAIN}`;
export const CSR_ALPHA_NEEDS = 'Kebutuhan rahasia Alpha E2E';
export const CSR_BETA_EMAIL = 'csr@e2e-beta.example';
export const CSR_BETA_NEEDS = 'Kebutuhan rahasia Beta E2E';
