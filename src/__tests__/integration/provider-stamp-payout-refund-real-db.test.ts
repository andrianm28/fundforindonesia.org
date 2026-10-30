// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Provider stamp on the Payout and Refund legs (ticket 69) against a REAL
 * Postgres. A completed Payout and a paid Refund both CREDIT GATEWAY_CLEARING;
 * until they name the provider that moved the money, providerBalances puts
 * those credits in the unnamed bucket and perProviderIsExact (the reconcile
 * route: unnamed bucket balance === 0) can never be true with two providers.
 *
 * Same throwaway-database setup as payout-fail-two-person-real-db.test.ts, and
 * a visible skip without TEST_DATABASE_URL.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Payout and Refund legs carry the provider -- against real Postgres', () => {
  if (!DATABASE_URL) {
    console.warn('[provider stamp] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `provider_stamp_${process.pid}`;
  let prisma: PrismaClient;
  let payouts: typeof import('@/lib/money/payouts');
  let refunds: typeof import('@/lib/money/refunds');
  let ledger: typeof import('@/lib/money/ledger');
  let withdrawals: typeof import('@/lib/money/provider-withdrawals');

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();

    const url = databaseUrlFor(databaseName);
    const migrator = new Client({ connectionString: url });
    await migrator.connect();
    try {
      const dirs = readdirSync('prisma/migrations')
        .filter((d) => !d.startsWith('migration_lock'))
        .sort();
      for (const dir of dirs) await migrator.query(readFileSync(join('prisma/migrations', dir, 'migration.sql'), 'utf8'));
    } finally {
      await migrator.end();
    }

    const adapter = new PrismaPg({ connectionString: url });
    const { PrismaClient: RealPrismaClient } = await import('@/generated/prisma/client');
    prisma = new RealPrismaClient({ adapter });
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    payouts = await import('@/lib/money/payouts');
    refunds = await import('@/lib/money/refunds');
    ledger = await import('@/lib/money/ledger');
    withdrawals = await import('@/lib/money/provider-withdrawals');
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

  async function makeUser(): Promise<string> {
    const id = `u-${process.pid}-${next()}`;
    await prisma.user.create({
      data: { id, name: 'Test', emailHmac: `${id}-hmac`, emailHmacKeyId: 'k', emailCiphertext: `${id}-c`, emailKeyId: 'k' },
    });
    return id;
  }

  async function makeCampaign(): Promise<{ id: string; ownerId: string }> {
    const ownerId = await makeUser();
    const id = `campaign-${process.pid}-${next()}`;
    await prisma.campaign.create({
      data: {
        id,
        slug: id,
        title: id,
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 10_000_000,
        category: 'Zakat Maal',
        kind: 'ZAKAT',
        creatorId: ownerId,
        lifecycleStatus: 'ACTIVE',
      },
    });
    return { id, ownerId };
  }

  const GROSS = 300_000;
  const PROVIDER_FEE = 15_000;
  const PLATFORM_FEE = 7_500;
  const NET = GROSS - PROVIDER_FEE - PLATFORM_FEE;

  /** A PAID, escrow-released Payment settled through `provider`, its GATEWAY_CLEARING debit stamped. */
  async function seedPayment(campaignId: string, provider: string) {
    const donationId = `donation-${process.pid}-${next()}`;
    await prisma.donation.create({ data: { id: donationId, amount: GROSS, paymentMethod: 'bank_transfer', campaignId } });
    const payment = await prisma.payment.create({
      data: {
        donationId,
        provider,
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: GROSS,
        providerFee: PROVIDER_FEE,
        platformFee: PLATFORM_FEE,
        status: 'PAID',
        escrowReleasedAt: new Date(Date.now() - 60_000),
      },
    });
    const subject = { type: 'campaign' as const, campaignId };
    await prisma.$transaction(async (tx) => {
      await ledger.postTransaction(
        tx,
        ledger.paymentSettledLegs({ subject, grossAmount: GROSS, providerFee: PROVIDER_FEE, platformFee: PLATFORM_FEE }),
        { paymentId: payment.id, provider },
      );
      await ledger.postTransaction(tx, ledger.escrowReleaseLegs({ subject, amount: NET }));
    });
    return payment;
  }

  async function draftPayout(campaign: { id: string; ownerId: string }, amount: number) {
    const bank = await prisma.bankAccount.create({
      data: {
        ownerId: campaign.ownerId,
        bankCode: 'BCA',
        accountNumberCiphertext: 'c',
        accountNumberKeyId: 'k',
        accountName: 'Fundraiser',
        verifiedAt: new Date(),
      },
    });
    return prisma.payout.create({
      data: {
        campaignId: campaign.id,
        bankAccountId: bank.id,
        amount,
        description: 'p',
        status: 'DRAFT',
        requestedById: campaign.ownerId,
      },
    });
  }

  const proof = { proofReference: 'TRX-12345', proofNote: 'Ditransfer manual lewat dashboard penyedia, cocok dengan rekening.' };
  const destination = { donorBankCode: 'BCA', donorAccountName: 'Budi Santoso', donorAccountNumber: '1234567890' };

  async function pots() {
    const rows = await prisma.$transaction((tx) => ledger.providerBalances(tx));
    return Object.fromEntries(rows.map((r) => [r.provider ?? 'UNNAMED', r.balance]));
  }

  it('a completed Payout credits the provider that was read at approval, not the unnamed bucket', async () => {
    const campaign = await makeCampaign();
    await seedPayment(campaign.id, 'mock');
    await seedPayment(campaign.id, 'sumopod');
    const payout = await draftPayout(campaign, NET);
    const before = await pots();

    await payouts.approvePayout(prisma, {
      payoutId: payout.id,
      approvedById: await makeUser(),
      provider: 'sumopod',
      providerBalance: 10_000_000,
    });
    await payouts.completePayout(prisma, { payoutId: payout.id, completedById: await makeUser(), ...proof });

    const after = await pots();
    expect((after.sumopod ?? 0) - (before.sumopod ?? 0)).toBe(-NET);
    expect(after.mock ?? 0).toBe(before.mock ?? 0);
    expect(after.UNNAMED ?? 0).toBe(before.UNNAMED ?? 0);
    const legs = await prisma.ledgerEntry.findMany({ where: { payoutId: payout.id } });
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l) => l.provider === 'sumopod')).toBe(true);
  }, 60_000);

  it('a failed Payout mirrors the instruction legs under the same provider', async () => {
    const campaign = await makeCampaign();
    await seedPayment(campaign.id, 'mock');
    const payout = await draftPayout(campaign, NET);
    const approver = await makeUser();
    await payouts.approvePayout(prisma, { payoutId: payout.id, approvedById: approver, provider: 'mock', providerBalance: 10_000_000 });

    await payouts.failPayout(prisma, { payoutId: payout.id, failedById: await makeUser(), reason: 'Transfer ditolak' });

    const legs = await prisma.ledgerEntry.findMany({ where: { payoutId: payout.id } });
    expect(legs.length).toBe(4);
    expect(legs.every((l) => l.provider === 'mock')).toBe(true);
  }, 60_000);

  it('a paid Refund credits the provider of the Payment it refunds, and every Refund leg carries it', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, 'mock');
    await seedPayment(campaign.id, 'sumopod');
    const before = await pots();

    const requestedById = await makeUser();
    const refund = await prisma.$transaction((tx) =>
      refunds.createRefund(tx, {
        subject: { type: 'campaign', campaignId: campaign.id },
        paymentId: payment.id,
        amount: GROSS,
        reason: 'salah bayar',
        requestedById,
      }),
    );
    await refunds.approveRefund(prisma, { refundId: refund.id, approvedById: await makeUser(), ...destination });
    await refunds.completeRefund(prisma, {
      refundId: refund.id,
      completedById: await makeUser(),
      ...proof,
      donorAccountNumber: destination.donorAccountNumber,
    });

    const after = await pots();
    expect((after.mock ?? 0) - (before.mock ?? 0)).toBe(-GROSS);
    expect(after.sumopod ?? 0).toBe(before.sumopod ?? 0);
    expect(after.UNNAMED ?? 0).toBe(before.UNNAMED ?? 0);
    const legs = await prisma.ledgerEntry.findMany({ where: { refundId: refund.id } });
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l) => l.provider === 'mock')).toBe(true);
  }, 60_000);

  it('a failed Refund mirrors its legs under the Payment provider', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, 'sumopod');
    const requestedById = await makeUser();
    const refund = await prisma.$transaction((tx) =>
      refunds.createRefund(tx, {
        subject: { type: 'campaign', campaignId: campaign.id },
        paymentId: payment.id,
        amount: GROSS,
        reason: 'salah bayar',
        requestedById,
      }),
    );
    const approver = await makeUser();
    await refunds.approveRefund(prisma, { refundId: refund.id, approvedById: approver, ...destination });
    await refunds.failRefund(prisma, { refundId: refund.id, failedById: await makeUser(), reason: 'Rekening ditutup' });

    const legs = await prisma.ledgerEntry.findMany({ where: { refundId: refund.id } });
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l) => l.provider === 'sumopod')).toBe(true);
  }, 60_000);

  it('a rejected Refund reverses its freeze under the Payment provider', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, 'sumopod');
    const requestedById = await makeUser();
    const refund = await prisma.$transaction((tx) =>
      refunds.createRefund(tx, {
        subject: { type: 'campaign', campaignId: campaign.id },
        paymentId: payment.id,
        amount: GROSS,
        reason: 'salah bayar',
        requestedById,
      }),
    );
    await refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: await makeUser(), reason: 'Salah Payment' });

    const reversal = await prisma.ledgerEntry.findMany({ where: { transactionId: `refund-rejected-${refund.id}` } });
    expect(reversal.length).toBeGreaterThan(0);
    expect(reversal.every((l) => l.provider === 'sumopod')).toBe(true);
  }, 60_000);

  it('two providers in isolation: exact pots from hard-coded amounts, no unnamed bucket, reconciled per provider', async () => {
    // Own database state: remove everything the tests above posted, so the
    // expected figures below come from this scenario's inputs alone.
    await prisma.$executeRawUnsafe('TRUNCATE "LedgerEntry" CASCADE');
    const campaign = await makeCampaign();
    // Settlement debits GATEWAY_CLEARING by GROSS (300_000) per Payment.
    await seedPayment(campaign.id, 'mock');
    const sumopodPayment = await seedPayment(campaign.id, 'sumopod');
    await seedPayment(campaign.id, 'sumopod');
    // Payout of 277_500 completes through sumopod; a full Refund of the first
    // sumopod Payment (300_000) completes through sumopod's Payment too.
    const payout = await draftPayout(campaign, 277_500);
    await payouts.approvePayout(prisma, { payoutId: payout.id, approvedById: await makeUser(), provider: 'sumopod', providerBalance: 10_000_000 });
    await payouts.completePayout(prisma, { payoutId: payout.id, completedById: await makeUser(), ...proof });
    const requestedById = await makeUser();
    const refund = await prisma.$transaction((tx) =>
      refunds.createRefund(tx, {
        subject: { type: 'campaign', campaignId: campaign.id },
        paymentId: sumopodPayment.id,
        amount: GROSS,
        reason: 'salah bayar',
        requestedById,
      }),
    );
    await refunds.approveRefund(prisma, { refundId: refund.id, approvedById: await makeUser(), ...destination });
    await refunds.completeRefund(prisma, {
      refundId: refund.id,
      completedById: await makeUser(),
      ...proof,
      donorAccountNumber: destination.donorAccountNumber,
    });
    await prisma.providerWithdrawal.create({
      data: {
        provider: 'mock',
        reference: `wd-${process.pid}`,
        amount: 100_000,
        destinationName: 'Bank',
        providerBalanceBefore: 500_000,
        providerBalanceAfter: 400_000,
        proofReference: 'WD-1',
        recordedById: await makeUser(),
      } as never,
    });

    const pot = await pots();
    expect(pot).toEqual({ mock: 300_000, sumopod: 2 * 300_000 - 277_500 - 300_000 });
    expect(pot.UNNAMED).toBeUndefined();

    const report = await prisma.$transaction((tx) => withdrawals.reconcileProviderBalances(tx));
    expect(report.map((r) => [r.provider, r.pot.balance])).toEqual([['mock', 300_000]]);
    // perProviderIsExact in the reconcile route is exactly "unnamed bucket balance === 0".
    const unnamed = (await prisma.$transaction((tx) => ledger.providerBalances(tx))).find((p) => p.provider === null);
    expect((unnamed?.balance ?? 0) === 0).toBe(true);
  }, 60_000);

  it('a legacy Payout approved with no provider on its row stays in the unnamed bucket, not migrated', async () => {
    const campaign = await makeCampaign();
    await seedPayment(campaign.id, 'mock');
    const draft = await draftPayout(campaign, NET);
    // Approved before approvedProvider existed: no reading on the row.
    await prisma.payout.update({ where: { id: draft.id }, data: { status: 'APPROVED', approvedById: await makeUser(), approvedAt: new Date() } });
    await prisma.$transaction((tx) =>
      ledger.postTransaction(tx, ledger.payoutInstructedLegs({ subject: { type: 'campaign', campaignId: campaign.id }, amount: NET }), {
        payoutId: draft.id,
        transactionId: `payout-instructed-${draft.id}`,
      }),
    );
    const before = await pots();

    await payouts.completePayout(prisma, { payoutId: draft.id, completedById: await makeUser(), ...proof });

    const after = await pots();
    expect((after.UNNAMED ?? 0) - (before.UNNAMED ?? 0)).toBe(-NET);
    expect(after.mock ?? 0).toBe(before.mock ?? 0);
    const completed = await prisma.ledgerEntry.findMany({ where: { transactionId: `payout-completed-${draft.id}` } });
    expect(completed.every((l) => l.provider === null)).toBe(true);
  }, 60_000);
});
