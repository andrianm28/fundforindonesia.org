// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Refund reject and fail (prd-compliance 49) against a REAL Postgres.
 *
 * What a JS fake cannot prove: that the mirror journal returns every account
 * to exactly where it was before the Refund, that a reject racing an approve
 * serialises on the Campaign row lock so exactly one wins, and that the ledger
 * stays balanced whichever does. Same setup as campaign-transfer-real-db.test.ts:
 * a throwaway database migrated by replaying every migration, and a visible
 * skip when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Refund reject and fail -- against real Postgres (prd-compliance 49)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[refund reject/fail] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `refund_reject_fail_${process.pid}`;
  let prisma: PrismaClient;
  let refunds: typeof import('@/lib/money/refunds');
  let ledger: typeof import('@/lib/money/ledger');

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
    refunds = await import('@/lib/money/refunds');
    ledger = await import('@/lib/money/ledger');
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

  async function makeCampaign(balance = 0): Promise<{ id: string; ownerId: string }> {
    const ownerId = await makeUser();
    const id = `campaign-${process.pid}-${next()}`;
    await prisma.campaign.create({
      data: {
        id,
        slug: id,
        title: `Campaign ${id}`,
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
    if (balance > 0) {
      await prisma.$transaction((tx) =>
        ledger.postTransaction(tx, [
          { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: balance },
          { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: balance, campaignId: id },
        ]),
      );
    }
    return { id, ownerId };
  }

  const GROSS = 300_000;
  const PROVIDER_FEE = 15_000;
  const PLATFORM_FEE = 7_500;

  /** A PAID Payment settled into ESCROW_HOLD (held) or already released to the balance. */
  async function seedPayment(campaignId: string, released: boolean) {
    const donationId = `donation-${process.pid}-${next()}`;
    await prisma.donation.create({ data: { id: donationId, amount: GROSS, paymentMethod: 'bank_transfer', campaignId } });
    const payment = await prisma.payment.create({
      data: {
        donationId,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: GROSS,
        providerFee: PROVIDER_FEE,
        platformFee: PLATFORM_FEE,
        status: 'PAID',
        escrowReleasedAt: released ? new Date(Date.now() - 60_000) : null,
      },
    });
    const subject = { type: 'campaign' as const, campaignId };
    await prisma.$transaction(async (tx) => {
      await ledger.postTransaction(
        tx,
        ledger.paymentSettledLegs({ subject, grossAmount: GROSS, providerFee: PROVIDER_FEE, platformFee: PLATFORM_FEE }),
        { paymentId: payment.id },
      );
      if (released) {
        await ledger.postTransaction(tx, ledger.escrowReleaseLegs({ subject, amount: GROSS - PROVIDER_FEE - PLATFORM_FEE }));
      }
    });
    return payment;
  }

  function request(campaignId: string, paymentId: string, by: string, amount = GROSS) {
    return prisma.$transaction((tx) =>
      refunds.createRefund(tx, {
        subject: { type: 'campaign', campaignId },
        paymentId,
        amount,
        reason: 'salah bayar',
        requestedById: by,
      }),
    );
  }

  const destination = { donorBankCode: 'BCA', donorAccountName: 'Budi Santoso', donorAccountNumber: '1234567890' };

  /** Net signed (credit +, debit -) per account, over every entry in the database, scoped to a Campaign's accounts. */
  async function accountNet(account: string, campaignId?: string): Promise<number> {
    const rows = await prisma.ledgerEntry.findMany({
      where: { account: account as never, ...(campaignId ? { campaignId } : {}) },
      select: { direction: true, amount: true },
    });
    return rows.reduce((sum, r) => sum + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
  }

  /** Every account that a Refund of this Campaign could touch, as one snapshot. */
  async function snapshot(campaignId: string) {
    return {
      escrow: await accountNet('ESCROW_HOLD', campaignId),
      balance: await accountNet('CAMPAIGN_BALANCE', campaignId),
      frozen: await accountNet('FROZEN_BALANCE', campaignId),
      clearing: await accountNet('REFUND_CLEARING'),
      refundCost: await accountNet('REFUND_COST'),
      platformFee: await accountNet('PLATFORM_FEE'),
    };
  }

  async function expectLedgerBalanced(): Promise<void> {
    const rows = await prisma.ledgerEntry.findMany({ select: { transactionId: true, direction: true, amount: true } });
    const net = new Map<string, number>();
    for (const r of rows) {
      net.set(r.transactionId, (net.get(r.transactionId) ?? 0) + (r.direction === 'DEBIT' ? r.amount : -r.amount));
    }
    for (const [transactionId, sum] of net) expect(`${transactionId}:${sum}`).toBe(`${transactionId}:0`);
  }

  it('reject returns a frozen Escrow Hold exactly, records who/when/why, and a second reject is a 409', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, false);
    const requester = await makeUser();
    const rejecter = await makeUser();
    const before = await snapshot(campaign.id);

    const refund = await request(campaign.id, payment.id, requester);
    expect(await snapshot(campaign.id)).not.toEqual(before);

    const rejected = await refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: rejecter, reason: 'Salah Payment' });

    expect(rejected).toMatchObject({ status: 'REJECTED', rejectedById: rejecter, rejectionReason: 'Salah Payment' });
    expect(rejected.rejectedAt).toBeInstanceOf(Date);
    expect(await snapshot(campaign.id)).toEqual(before);
    await expect(
      refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: await makeUser(), reason: 'lagi' }),
    ).rejects.toMatchObject({ code: 'INVALID_REFUND_STATUS' });
    expect(await snapshot(campaign.id)).toEqual(before);
    await expectLedgerBalanced();
  }, 60_000);

  it('a rejected Refund no longer counts against the cap: the same amount can be requested again', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, false);
    const requester = await makeUser();
    const first = await request(campaign.id, payment.id, requester);
    await expect(request(campaign.id, payment.id, requester)).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_REMAINING' });

    await refunds.rejectRefund(prisma, { refundId: first.id, rejectedById: await makeUser(), reason: 'x' });

    await expect(request(campaign.id, payment.id, requester)).resolves.toMatchObject({ status: 'REQUESTED' });
  }, 60_000);

  it('reject is refused to the requester and to the Campaign Fundraiser, leaving the freeze in place', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, false);
    const requester = await makeUser();
    const refund = await request(campaign.id, payment.id, requester);
    const frozen = await snapshot(campaign.id);

    await expect(
      refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: requester, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'REFUND_RESOLUTION_ACTOR' });
    await expect(
      refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: campaign.ownerId, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT' });

    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('REQUESTED');
    expect(await snapshot(campaign.id)).toEqual(frozen);
  }, 60_000);

  it('fail returns money from REFUND_CLEARING to the account it came from, shortfall included', async () => {
    // Released Payment whose balance a Payout already spent down: the freeze
    // takes the withdrawable balance negative, and approval has the platform
    // cover the shortfall with REFUND_COST. Fail must undo both.
    const campaign = await makeCampaign(50_000);
    const payment = await seedPayment(campaign.id, true);
    const requester = await makeUser();
    const approver = await makeUser();
    const failer = await makeUser();
    // A Payout already drew the Payment's net share out of the balance.
    await prisma.$transaction((tx) =>
      ledger.postTransaction(tx, [
        { account: 'CAMPAIGN_BALANCE', direction: 'DEBIT', amount: GROSS - PROVIDER_FEE - PLATFORM_FEE + 50_000, campaignId: campaign.id },
        { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: GROSS - PROVIDER_FEE - PLATFORM_FEE + 50_000 },
      ]),
    );
    const before = await snapshot(campaign.id);

    const refund = await request(campaign.id, payment.id, requester);
    await refunds.approveRefund(prisma, { refundId: refund.id, approvedById: approver, ...destination });
    const approved = await snapshot(campaign.id);
    expect(approved.clearing - before.clearing).toBe(GROSS);
    expect(approved.refundCost).not.toBe(before.refundCost);

    await expect(
      refunds.failRefund(prisma, { refundId: refund.id, failedById: approver, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'REFUND_RESOLUTION_ACTOR' });

    const failed = await refunds.failRefund(prisma, { refundId: refund.id, failedById: failer, reason: 'Rekening Donor ditutup' });

    expect(failed).toMatchObject({ status: 'FAILED', failedById: failer, failureReason: 'Rekening Donor ditutup' });
    expect(failed.failedAt).toBeInstanceOf(Date);
    expect(await snapshot(campaign.id)).toEqual(before);
    await expect(
      refunds.failRefund(prisma, { refundId: refund.id, failedById: await makeUser(), reason: 'lagi' }),
    ).rejects.toMatchObject({ code: 'INVALID_REFUND_STATUS' });
    await expectLedgerBalanced();
  }, 60_000);

  it('a COMPLETED Refund can be neither rejected nor failed', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, false);
    const requester = await makeUser();
    const approver = await makeUser();
    const completer = await makeUser();
    const refund = await request(campaign.id, payment.id, requester);
    await refunds.approveRefund(prisma, { refundId: refund.id, approvedById: approver, ...destination });
    await refunds.completeRefund(prisma, {
      refundId: refund.id,
      completedById: completer,
      proofReference: 'TRX-12345',
      proofNote: 'Ditransfer via mobile banking, dicocokkan dengan nama dan rekening Donor.',
      donorAccountNumber: destination.donorAccountNumber,
    });
    const done = await snapshot(campaign.id);

    await expect(
      refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: await makeUser(), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_REFUND_STATUS' });
    await expect(
      refunds.failRefund(prisma, { refundId: refund.id, failedById: await makeUser(), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_REFUND_STATUS' });
    expect(await snapshot(campaign.id)).toEqual(done);
  }, 60_000);

  it('a fail after the escrow was swept releases the returned share instead of stranding it in ESCROW_HOLD', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, false);
    const requester = await makeUser();
    const approver = await makeUser();
    const refund = await request(campaign.id, payment.id, requester);
    await refunds.approveRefund(prisma, { refundId: refund.id, approvedById: approver, ...destination });
    // The sweep does not defer for an APPROVED Refund: it stamps the Payment
    // and releases net - (this Refund's net share) = 0 here.
    await prisma.payment.update({ where: { id: payment.id }, data: { escrowReleasedAt: new Date() } });

    await refunds.failRefund(prisma, { refundId: refund.id, failedById: await makeUser(), reason: 'x' });

    expect(await accountNet('ESCROW_HOLD', campaign.id)).toBe(0);
    expect(await accountNet('CAMPAIGN_BALANCE', campaign.id)).toBe(GROSS - PROVIDER_FEE - PLATFORM_FEE);
    expect(await accountNet('FROZEN_BALANCE', campaign.id)).toBe(0);
    await expectLedgerBalanced();
  }, 60_000);

  it('reject racing approve on one Refund: exactly one wins, and the ledger agrees with the status', async () => {
    const campaign = await makeCampaign();
    const payment = await seedPayment(campaign.id, false);
    const requester = await makeUser();
    const before = await snapshot(campaign.id);
    const refund = await request(campaign.id, payment.id, requester);

    const outcomes = await Promise.allSettled([
      refunds.approveRefund(prisma, { refundId: refund.id, approvedById: await makeUser(), ...destination }),
      refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: await makeUser(), reason: 'x' }),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const lost = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected')!;
    expect(lost.reason).toMatchObject({ code: 'INVALID_REFUND_STATUS' });

    const final = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    const after = await snapshot(campaign.id);
    if (final.status === 'REJECTED') {
      expect(after).toEqual(before);
      expect(await prisma.ledgerEntry.count({ where: { transactionId: `refund-approved-${refund.id}` } })).toBe(0);
    } else {
      expect(final.status).toBe('APPROVED');
      expect(after.clearing - before.clearing).toBe(GROSS);
      expect(await prisma.ledgerEntry.count({ where: { transactionId: `refund-rejected-${refund.id}` } })).toBe(0);
    }
    await expectLedgerBalanced();
  }, 60_000);
});
