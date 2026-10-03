// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Ticket 36 (PRD FFI-16): a Donor's identity is removed and the money stays,
 * against a REAL Postgres. What is under test is a transaction that nulls
 * contact columns while holding the Payment row lock createRefund also takes,
 * so a mock would prove the mock. Same setup as stuck-refund-sweep.test.ts:
 * a throwaway database migrated by replaying every migration, and a visible
 * skip (not a green pass) when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('donor anonymisation -- against real Postgres (ticket 36)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[donor anonymisation] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `donor_anonymisation_${process.pid}`;
  let prisma: PrismaClient;
  let anonymiseGuestDonor: typeof import('@/lib/donor-anonymisation').anonymiseGuestDonor;
  let anonymiseRegisteredDonor: typeof import('@/lib/donor-anonymisation').anonymiseRegisteredDonor;
  let createRefund: typeof import('@/lib/money/refunds').createRefund;
  let postTransaction: typeof import('@/lib/money/ledger').postTransaction;
  let paymentSettledLegs: typeof import('@/lib/money/ledger').paymentSettledLegs;
  let errors: typeof import('@/lib/money/errors');
  let sealDonationGuestEmail: typeof import('@/lib/contact-fields').sealDonationGuestEmail;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.FIELD_ENCRYPTION_KEY_ID = 'enc-1';
    process.env.FIELD_HMAC_KEY = randomBytes(32).toString('base64');
    process.env.FIELD_HMAC_KEY_ID = 'hmac-1';
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();

    const url = databaseUrlFor(databaseName);
    const migrator = new Client({ connectionString: url });
    await migrator.connect();
    try {
      const dirs = readdirSync(MIGRATIONS_DIR)
        .filter((d) => !d.startsWith('migration_lock'))
        .sort();
      for (const dir of dirs) await migrator.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
    } finally {
      await migrator.end();
    }

    const adapter = new PrismaPg({ connectionString: url });
    const { PrismaClient: RealPrismaClient } = await import('@/generated/prisma/client');
    prisma = new RealPrismaClient({ adapter });
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    ({ anonymiseGuestDonor, anonymiseRegisteredDonor } = await import('@/lib/donor-anonymisation'));
    ({ createRefund } = await import('@/lib/money/refunds'));
    ({ postTransaction, paymentSettledLegs } = await import('@/lib/money/ledger'));
    errors = await import('@/lib/money/errors');
    ({ sealDonationGuestEmail } = await import('@/lib/contact-fields'));
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  let counter = 0;
  const next = () => counter++;

  async function makeUser(name = 'Test'): Promise<string> {
    const id = `u-${process.pid}-${next()}`;
    await prisma.user.create({
      data: {
        id,
        name,
        emailHmac: `${id}-hmac`,
        emailHmacKeyId: 'k',
        emailCiphertext: `${id}-c`,
        emailKeyId: 'k',
        phoneCiphertext: `${id}-phone`,
        phoneKeyId: 'k',
      },
    });
    return id;
  }

  async function makeCampaign(): Promise<string> {
    const creatorId = await makeUser('Fundraiser');
    const id = `campaign-${process.pid}-${next()}`;
    await prisma.campaign.create({
      data: {
        id,
        slug: id,
        title: 'Test Campaign',
        description: 'Test',
        story: 'Test',
        coverImage: 'https://example.com/cover.jpg',
        targetAmount: 10_000_000,
        category: 'test',
        creatorId,
        lifecycleStatus: 'ACTIVE',
      },
    });
    return id;
  }

  type Made = { donationId: string; paymentId: string; receiptToken: string; email: string };

  /** A settled Donation (PAID Payment, ledger legs, Receipt), guest or registered. */
  async function makeDonation(
    campaignId: string,
    who: { guestEmail: string; guestName?: string } | { donorId: string },
    amount = 100_000,
  ): Promise<Made> {
    const n = next();
    const donationId = `donation-${process.pid}-${n}`;
    await prisma.donation.create({
      data: {
        id: donationId,
        amount,
        paymentMethod: 'bank_transfer',
        paymentStatus: 'confirmed',
        campaignId,
        message: 'Semoga berkah',
        ...('donorId' in who
          ? { donorId: who.donorId }
          : {
              guestName: who.guestName ?? 'Budi Santoso',
              ...sealDonationGuestEmail(who.guestEmail),
              guestPhoneCiphertext: `${who.guestEmail}-phone`,
              guestPhoneKeyId: 'k',
            }),
      },
    });
    const paymentId = `payment-${process.pid}-${n}`;
    await prisma.payment.create({
      data: {
        id: paymentId,
        donationId,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${n}`,
        amount,
        providerFee: 1_000,
        status: 'PAID',
        paidAt: new Date(),
        settledAt: new Date(),
      },
    });
    await prisma.$transaction(async (tx) => {
      await postTransaction(
        tx,
        paymentSettledLegs({ subject: { type: 'campaign', campaignId }, grossAmount: amount, providerFee: 1_000 }),
        { paymentId, transactionId: `settle-${paymentId}` },
      );
    });
    const receiptToken = `tok-${process.pid}-${n}`;
    await prisma.receipt.create({ data: { donationId, token: receiptToken } });
    return { donationId, paymentId, receiptToken, email: 'guestEmail' in who ? who.guestEmail : '' };
  }

  /** Everything the ledger, escrow and reconciliation read, as one comparable value. */
  async function moneySnapshot(campaignId: string) {
    const entries = await prisma.ledgerEntry.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const payments = await prisma.payment.findMany({ orderBy: { id: 'asc' } });
    const donations = await prisma.donation.findMany({
      where: { campaignId },
      orderBy: { id: 'asc' },
      select: { id: true, amount: true, paymentStatus: true, campaignId: true },
    });
    return { entries, payments, donations };
  }

  const guestEmail = () => `donor-${process.pid}-${next()}@example.org`;

  it('anonymises a Guest Donor from the Receipt token: contact gone, ledger and amounts untouched', async () => {
    const campaignId = await makeCampaign();
    const mine = await makeDonation(campaignId, { guestEmail: guestEmail() });
    const before = await moneySnapshot(campaignId);

    const result = await anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: mine.email });

    expect(result).toEqual({ status: 'anonymised', anonymisedCount: 1 });
    const donation = await prisma.donation.findUniqueOrThrow({ where: { id: mine.donationId } });
    expect(donation).toMatchObject({
      guestName: null,
      guestEmailHmac: null,
      guestEmailHmacKeyId: null,
      guestEmailCiphertext: null,
      guestEmailKeyId: null,
      guestPhoneCiphertext: null,
      guestPhoneKeyId: null,
      donorId: null,
      isAnonymous: true,
      amount: 100_000,
    });
    expect(donation.anonymisedAt).toBeInstanceOf(Date);
    // The money row, the Payment, every ledger entry and the Receipt are as they were.
    expect(await moneySnapshot(campaignId)).toEqual(before);
    expect(await prisma.receipt.findUnique({ where: { token: mine.receiptToken } })).not.toBeNull();
  }, 60_000);

  it('anonymises only the Donation the Receipt belongs to; another with the same email stays intact', async () => {
    const campaignId = await makeCampaign();
    const email = guestEmail();
    const first = await makeDonation(campaignId, { guestEmail: email });
    const second = await makeDonation(await makeCampaign(), { guestEmail: email });
    const stranger = await makeDonation(campaignId, { guestEmail: guestEmail(), guestName: 'Orang Lain' });
    const secondBefore = await prisma.donation.findUniqueOrThrow({ where: { id: second.donationId } });

    const result = await anonymiseGuestDonor(prisma, { token: first.receiptToken, email });

    expect(result).toEqual({ status: 'anonymised', anonymisedCount: 1 });
    expect(await prisma.donation.findUniqueOrThrow({ where: { id: first.donationId } })).toMatchObject({
      guestName: null,
      guestEmailHmac: null,
    });
    expect(await prisma.donation.findUniqueOrThrow({ where: { id: second.donationId } })).toEqual(secondBefore);
    expect(await prisma.donation.findUniqueOrThrow({ where: { id: stranger.donationId } })).toMatchObject({
      guestName: 'Orang Lain',
      anonymisedAt: null,
    });
  }, 60_000);

  it('refuses a wrong email, says nothing about the right one, and changes nothing', async () => {
    const campaignId = await makeCampaign();
    const mine = await makeDonation(campaignId, { guestEmail: guestEmail() });
    const before = await prisma.donation.findUniqueOrThrow({ where: { id: mine.donationId } });

    const result = await anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: 'orang-lain@example.org' });

    expect(result).toEqual({ status: 'email-mismatch' });
    expect(await prisma.donation.findUniqueOrThrow({ where: { id: mine.donationId } })).toEqual(before);
  }, 60_000);

  it('accepts the right email whatever its letter case or surrounding spaces', async () => {
    const campaignId = await makeCampaign();
    const email = guestEmail();
    const mine = await makeDonation(campaignId, { guestEmail: email });

    const result = await anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: `  ${email.toUpperCase()} ` });

    expect(result).toEqual({ status: 'anonymised', anonymisedCount: 1 });
  }, 60_000);

  it('is idempotent: a second request changes nothing and says so', async () => {
    const campaignId = await makeCampaign();
    const mine = await makeDonation(campaignId, { guestEmail: guestEmail() });
    await anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: mine.email });
    const stamped = await prisma.donation.findUniqueOrThrow({ where: { id: mine.donationId } });

    const again = await anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: mine.email });

    expect(again).toEqual({ status: 'already-anonymised', anonymisedCount: 0 });
    expect(await prisma.donation.findUniqueOrThrow({ where: { id: mine.donationId } })).toEqual(stamped);
  }, 60_000);

  it('answers not-found for an unknown token', async () => {
    expect(await anonymiseGuestDonor(prisma, { token: 'no-such-token', email: 'a@example.org' })).toEqual({
      status: 'not-found',
    });
  });

  it('refuses the token path for a Donation that belongs to an account, and changes nothing', async () => {
    const campaignId = await makeCampaign();
    const donorId = await makeUser('Sari');
    const owned = await makeDonation(campaignId, { donorId });

    expect(await anonymiseGuestDonor(prisma, { token: owned.receiptToken, email: 'a@example.org' })).toEqual({
      status: 'account-owned',
    });
    expect(await prisma.donation.findUniqueOrThrow({ where: { id: owned.donationId } })).toMatchObject({
      donorId,
      anonymisedAt: null,
    });
  });

  it('anonymises a registered Donor from the account: Donations unlinked, account and other Donors untouched', async () => {
    const campaignId = await makeCampaign();
    const donorId = await makeUser('Sari');
    const otherId = await makeUser('Dewi');
    const a = await makeDonation(campaignId, { donorId });
    const b = await makeDonation(campaignId, { donorId }, 250_000);
    const others = await makeDonation(campaignId, { donorId: otherId });
    await prisma.prayer.create({ data: { text: 'Amin', donationId: a.donationId, campaignId, userId: donorId } });
    const before = await moneySnapshot(campaignId);
    const userBefore = await prisma.user.findUniqueOrThrow({ where: { id: donorId } });

    const result = await anonymiseRegisteredDonor(prisma, { userId: donorId });

    expect(result).toEqual({ status: 'anonymised', anonymisedCount: 2 });
    for (const made of [a, b]) {
      const donation = await prisma.donation.findUniqueOrThrow({ where: { id: made.donationId } });
      expect(donation).toMatchObject({ donorId: null, isAnonymous: true, guestName: null });
      expect(donation.anonymisedAt).toBeInstanceOf(Date);
    }
    expect(await prisma.prayer.findUniqueOrThrow({ where: { donationId: a.donationId } })).toMatchObject({
      userId: null,
      text: 'Amin',
    });
    expect(await prisma.donation.findUniqueOrThrow({ where: { id: others.donationId } })).toMatchObject({
      donorId: otherId,
      anonymisedAt: null,
    });
    expect(await moneySnapshot(campaignId)).toEqual(before);
    // The account is the Donor's own: this removes the link, not the account.
    expect(await prisma.user.findUniqueOrThrow({ where: { id: donorId } })).toEqual(userBefore);

    expect(await anonymiseRegisteredDonor(prisma, { userId: donorId })).toEqual({
      status: 'already-anonymised',
      anonymisedCount: 0,
    });
  }, 60_000);

  it('a registered Donor with no Donations gets already-anonymised, not an error', async () => {
    expect(await anonymiseRegisteredDonor(prisma, { userId: await makeUser() })).toEqual({
      status: 'already-anonymised',
      anonymisedCount: 0,
    });
  });

  it('is refused while a Refund on one of the Donations is still open, and changes nothing', async () => {
    const campaignId = await makeCampaign();
    const mine = await makeDonation(campaignId, { guestEmail: guestEmail() });
    const admin = await makeUser('Admin');
    await prisma.refund.create({
      data: {
        paymentId: mine.paymentId,
        amount: 100_000,
        reason: 'salah bayar',
        requestedById: admin,
        status: 'APPROVED',
      },
    });
    const before = await prisma.donation.findUniqueOrThrow({ where: { id: mine.donationId } });

    await expect(anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: mine.email })).rejects.toBeInstanceOf(
      errors.AnonymisationBlockedByOpenRefundError,
    );
    expect(await prisma.donation.findUniqueOrThrow({ where: { id: mine.donationId } })).toEqual(before);
  }, 60_000);

  it('is allowed once the Refund is finished, and leaves the finished Refund row exactly as it was', async () => {
    const campaignId = await makeCampaign();
    const mine = await makeDonation(campaignId, { guestEmail: guestEmail() });
    const admin = await makeUser('Admin');
    const refund = await prisma.refund.create({
      data: {
        paymentId: mine.paymentId,
        amount: 40_000,
        reason: 'salah bayar',
        requestedById: admin,
        status: 'COMPLETED',
        donorBankCode: 'BCA',
        donorAccountName: 'Budi Santoso',
        donorAccountNumberCiphertext: 'sealed',
        donorAccountNumberKeyId: 'k',
      },
    });

    expect(await anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: mine.email })).toMatchObject({
      status: 'anonymised',
    });
    // The Refund is a financial record under the ten-year retention (PRD FFI-16): not touched.
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).toEqual(refund);
  }, 60_000);

  it('createRefund refuses an anonymised Donation and posts nothing', async () => {
    const campaignId = await makeCampaign();
    const mine = await makeDonation(campaignId, { guestEmail: guestEmail() });
    const admin = await makeUser('Admin');
    await anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: mine.email });
    const entriesBefore = await prisma.ledgerEntry.count();

    await expect(
      prisma.$transaction((tx) =>
        createRefund(tx, {
          subject: { type: 'campaign', campaignId },
          paymentId: mine.paymentId,
          amount: 100_000,
          reason: 'salah bayar',
          requestedById: admin,
        }),
      ),
    ).rejects.toBeInstanceOf(errors.DonationAnonymisedError);

    expect(await prisma.refund.count({ where: { paymentId: mine.paymentId } })).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(entriesBefore);
  }, 60_000);

  it('a Refund and an anonymisation racing on one Donation never both win', async () => {
    for (let round = 0; round < 6; round++) {
      const campaignId = await makeCampaign();
      const mine = await makeDonation(campaignId, { guestEmail: guestEmail() });
      const admin = await makeUser('Admin');

      const [refund, anonymise] = await Promise.allSettled([
        prisma.$transaction((tx) =>
          createRefund(tx, {
            subject: { type: 'campaign', campaignId },
            paymentId: mine.paymentId,
            amount: 100_000,
            reason: 'salah bayar',
            requestedById: admin,
          }),
        ),
        anonymiseGuestDonor(prisma, { token: mine.receiptToken, email: mine.email }),
      ]);

      const donation = await prisma.donation.findUniqueOrThrow({ where: { id: mine.donationId } });
      const refunds = await prisma.refund.count({ where: { paymentId: mine.paymentId } });
      // Either the Refund exists and the Donor was told to wait, or the Donor
      // is anonymised and no Refund exists. Never an anonymised Donation with
      // an open Refund on it.
      expect(refunds > 0 && donation.anonymisedAt !== null).toBe(false);
      expect(refund.status === 'fulfilled' || anonymise.status === 'fulfilled').toBe(true);
      expect(refund.status === 'fulfilled').toBe(refunds === 1);
      expect(anonymise.status === 'fulfilled').toBe(donation.anonymisedAt !== null);
    }
  }, 120_000);
});
