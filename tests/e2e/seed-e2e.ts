/**
 * Fixtures for the Playwright e2e specs (tests/e2e/*.spec.ts).
 *
 * Run once per CI e2e job after `prisma migrate deploy`, against the job's
 * throwaway Postgres (the job sets the last two; export them yourself
 * against a local throwaway database, with any password of 16+ characters):
 *
 *   DATABASE_URL=postgresql://ci:ci@localhost:5432/ci \
 *   E2E_THROWAWAY_DATABASE=1 E2E_OPERATOR_PASSWORD=<16+ characters> \
 *   npx tsx tests/e2e/seed-e2e.ts
 *
 * Idempotent (upserts by fixed ids/slugs), so a rerun never duplicates.
 * Fixed ids keep the specs readable; this database is dropped with the job.
 *
 * What the specs need, and why it lives here rather than prisma/seed.ts:
 * the dev seed grows demo content for humans, while these rows are the
 * minimal contract each spec asserts against (slugs, a settled QRIS
 * donation's receipt token, a valid Fundraising Permit so the Active
 * campaign really accepts donations, a Verifier and an Admin who can sign
 * in). Nothing here is demo content, so nothing is flagged isDemo.
 */
import { PrismaClient, Kind, CampaignStatus, Assignment } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { sealDonationGuestEmail, sealUserEmail } from '../../src/lib/contact-fields';
import { hashPassword } from '../../src/lib/password-hash';
import { PASSWORD_HASH_COST } from '../../src/lib/password-hash-cost';
import {
  ACTIVE_CAMPAIGN_ID,
  ACTIVE_SLUG,
  ADMIN_EMAIL,
  DOCUMENT_CAMPAIGN_ID,
  DOCUMENT_FUNDRAISER_EMAIL,
  DOCUMENT_SLUG,
  DRAFT_SLUG,
  EDIT_FUNDRAISER_EMAIL,
  EDIT_SLUG,
  RECEIPT_TOKEN,
  STRANGER_EMAIL,
  RECEIPT_AMOUNT,
  VERIFIER_EMAIL,
  operatorPassword,
} from './fixtures';

// This seed creates an Admin and a Verifier who can sign in, so it runs only
// against a database someone has declared throwaway: E2E_THROWAWAY_DATABASE=1
// (set by the CI e2e job; export it yourself for a local throwaway database).
// A loopback host alone is not proof, because a production database can be
// reached over loopback on its own host; the host check is a second fence.
if (process.env.E2E_THROWAWAY_DATABASE !== '1') {
  throw new Error('seed-e2e refuses to run without E2E_THROWAWAY_DATABASE=1 (throwaway databases only).');
}
const databaseHost = new URL(process.env.DATABASE_URL ?? 'postgresql://unset').hostname;
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseHost)) {
  throw new Error(`seed-e2e refuses DATABASE_URL host ${JSON.stringify(databaseHost)}: local databases only.`);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Keyed on the fixed id, not the address: the address is a ciphertext now
  // (ADR 0012) and the id is what the specs assert against anyway.
  await prisma.user.upsert({
    where: { id: 'e2e-fundraiser' },
    update: {},
    create: {
      id: 'e2e-fundraiser',
      name: 'E2E Fundraiser',
      ...sealUserEmail('e2e-fundraiser@example.org'),
    },
  });
  await prisma.user.upsert({
    where: { id: 'e2e-org-owner' },
    update: {},
    create: {
      id: 'e2e-org-owner',
      name: 'E2E Org Owner',
      ...sealUserEmail('e2e-org-owner@example.org'),
    },
  });
  await prisma.user.upsert({
    where: { id: 'e2e-registrar' },
    update: {},
    create: {
      id: 'e2e-registrar',
      name: 'E2E Registrar',
      ...sealUserEmail('e2e-registrar@example.org'),
    },
  });

  // The Verifier who raises a Flag and the Admin who dismisses it
  // (flag-dismiss.spec.ts). Neither owns a Campaign, so neither is barred
  // from acting on the Active one below. They can sign in with credentials.
  // A rerun only refreshes the password hash (the password is drawn per run),
  // never re-grants an assignment.
  const operatorPasswordHash = await hashPassword(operatorPassword(), PASSWORD_HASH_COST);
  await prisma.user.upsert({
    where: { id: 'e2e-verifier' },
    update: { password: operatorPasswordHash },
    create: {
      id: 'e2e-verifier',
      name: 'E2E Verifier',
      password: operatorPasswordHash,
      ...sealUserEmail(VERIFIER_EMAIL),
      assignments: { create: { assignment: Assignment.VERIFIER } },
    },
  });
  await prisma.user.upsert({
    where: { id: 'e2e-admin' },
    update: { password: operatorPasswordHash },
    create: {
      id: 'e2e-admin',
      name: 'E2E Admin',
      password: operatorPasswordHash,
      ...sealUserEmail(ADMIN_EMAIL),
      assignments: { create: { assignment: Assignment.ADMIN } },
    },
  });

  await prisma.partnerOrganisation.upsert({
    where: { id: 'e2e-org' },
    update: {},
    create: {
      id: 'e2e-org',
      name: 'E2E Penghimpun',
      fundraiserId: 'e2e-org-owner',
      registeredById: 'e2e-registrar',
      acceptsIndividualCampaigns: true,
    },
  });

  // A permit valid now for the DONATION kind: without it the Active
  // campaign below refuses donations (collectingEntityBlock) and the
  // donate page shows a refusal instead of the form.
  await prisma.fundraisingPermit.upsert({
    where: { id: 'e2e-permit' },
    update: {},
    create: {
      id: 'e2e-permit',
      partnerOrganisationId: 'e2e-org',
      number: 'E2E/001',
      issuer: 'E2E Kemensos',
      kinds: [Kind.DONATION],
      validFrom: new Date('2020-01-01T00:00:00.000Z'),
      validTo: new Date('2030-01-01T00:00:00.000Z'),
      recordedById: 'e2e-registrar',
    },
  });

  await prisma.campaign.upsert({
    where: { slug: ACTIVE_SLUG },
    update: {},
    create: {
      id: ACTIVE_CAMPAIGN_ID,
      slug: ACTIVE_SLUG,
      title: 'E2E Air Bersih Desa',
      description: 'Campaign fixture untuk e2e donasi QRIS.',
      story: 'Cerita fixture untuk e2e donasi QRIS.',
      coverImage: 'https://example.org/e2e.jpg',
      targetAmount: 10_000_000,
      category: 'bencana',
      kind: Kind.DONATION,
      lifecycleStatus: CampaignStatus.ACTIVE,
      deadline: new Date('2030-06-01T00:00:00.000Z'),
      creatorId: 'e2e-fundraiser',
      collectingEntityId: 'e2e-org',
    },
  });

  // Unapproved: the cached page 404s for everyone; only the Fundraiser,
  // Verifiers and Admins get it back from the session-aware API.
  await prisma.campaign.upsert({
    where: { slug: DRAFT_SLUG },
    update: {},
    create: {
      id: 'e2e-campaign-draft',
      slug: DRAFT_SLUG,
      title: 'E2E Sumur Draf',
      description: 'Campaign draf untuk e2e not-found istimewa.',
      story: 'Cerita draf untuk e2e.',
      coverImage: 'https://example.org/e2e-draft.jpg',
      targetAmount: 5_000_000,
      category: 'lingkungan',
      kind: Kind.DONATION,
      lifecycleStatus: CampaignStatus.DRAFT,
      creatorId: 'e2e-fundraiser',
    },
  });

  // Ticket 64: a submitted Campaign whose open request needs the KTP paper
  // (the migration marks "identitas-fundraiser" as a document item), its
  // Fundraiser, and a stranger, both able to sign in like the operators.
  for (const [id, name, email] of [
    ['e2e-doc-fundraiser', 'E2E Doc Fundraiser', DOCUMENT_FUNDRAISER_EMAIL],
    ['e2e-stranger', 'E2E Stranger', STRANGER_EMAIL],
    ['e2e-edit-fundraiser', 'E2E Edit Fundraiser', EDIT_FUNDRAISER_EMAIL],
  ] as const) {
    await prisma.user.upsert({
      where: { id },
      update: { password: operatorPasswordHash },
      create: { id, name, password: operatorPasswordHash, ...sealUserEmail(email) },
    });
  }
  await prisma.campaign.upsert({
    where: { slug: DOCUMENT_SLUG },
    update: {},
    create: {
      id: DOCUMENT_CAMPAIGN_ID,
      slug: DOCUMENT_SLUG,
      title: 'E2E Dokumen Diajukan',
      description: 'Campaign fixture untuk e2e dokumen privat.',
      story: 'Cerita fixture untuk e2e dokumen privat.',
      coverImage: 'https://example.org/e2e-dokumen.jpg',
      targetAmount: 3_000_000,
      category: 'lingkungan',
      kind: Kind.DONATION,
      lifecycleStatus: CampaignStatus.SUBMITTED,
      deadline: new Date('2030-06-01T00:00:00.000Z'),
      creatorId: 'e2e-doc-fundraiser',
      collectingEntityId: 'e2e-org',
    },
  });
  // Tickets 72, 65: a Draft its Fundraiser edits from the manage screen.
  await prisma.campaign.upsert({
    where: { slug: EDIT_SLUG },
    update: {},
    create: {
      id: 'e2e-campaign-draft-edit',
      slug: EDIT_SLUG,
      title: 'E2E Draft Untuk Diedit',
      description: 'Campaign fixture untuk e2e layar edit Fundraiser.',
      story: 'Cerita fixture untuk e2e layar edit Fundraiser, cukup panjang untuk lolos batas lima puluh karakter.',
      coverImage: 'https://example.org/e2e-edit.jpg',
      targetAmount: 2_000_000,
      category: 'lingkungan',
      kind: Kind.DONATION,
      lifecycleStatus: CampaignStatus.DRAFT,
      deadline: new Date('2030-06-01T00:00:00.000Z'),
      creatorId: 'e2e-edit-fundraiser',
      collectingEntityId: 'e2e-org',
    },
  });
  await prisma.verificationRequest.upsert({
    where: { id: 'e2e-vr-dokumen' },
    update: {},
    create: {
      id: 'e2e-vr-dokumen',
      campaignId: DOCUMENT_CAMPAIGN_ID,
      submittedById: 'e2e-doc-fundraiser',
      isFirst: true,
      collectingEntityId: 'e2e-org',
      checklist: [
        {
          id: 'identitas-fundraiser',
          label: 'KTP Fundraiser perorangan atau akta pendirian organisasi',
          required: true,
          position: 1,
          ticked: false,
          requiresDocument: true,
        },
      ],
    },
  });

  // A settled QRIS donation: the receipt is created at settle time, so the
  // fixture writes both rows the way settlement would leave them.
  await prisma.donation.upsert({
    where: { id: 'e2e-donation-settled' },
    update: {},
    create: {
      id: 'e2e-donation-settled',
      amount: RECEIPT_AMOUNT,
      paymentMethod: 'qris',
      paymentStatus: 'confirmed',
      campaignId: ACTIVE_CAMPAIGN_ID,
      ...sealDonationGuestEmail('e2e-donor@example.org'),
    },
  });
  await prisma.receipt.upsert({
    where: { donationId: 'e2e-donation-settled' },
    update: {},
    create: {
      id: 'e2e-receipt',
      donationId: 'e2e-donation-settled',
      token: RECEIPT_TOKEN,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
