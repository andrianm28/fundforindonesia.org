// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * The escrow sweep releases what a Refund's freeze actually left in Escrow Hold
 * (prd-compliance 51), against a REAL Postgres.
 *
 * The sweep (releaseMaturedEscrow, src/lib/money/escrow.ts) has to know how
 * much of a Payment's Net each live Refund took out of ESCROW_HOLD, and the
 * Refund's freeze already posted that number. Working it out again from the
 * Refunds still standing gives the same figure only while every Refund was
 * split against the same set of earlier Refunds that stands now, and rejecting
 * a Refund (prd-compliance 49) is what makes that stop being true. So the
 * sweep has to read the posted entry, not recompute it.
 *
 * ORDER MATTERS, and it is not the order the ticket's checklist lists
 * (.scratch/prd-compliance-fase-0-2/issues/51). A Refund rejected BEFORE the
 * second one is created never disagrees: createRefund leaves rejected Refunds
 * out of the earlier-Refund set at creation, so the freeze and any later
 * recomputation start from the same set. The set differs only when the second
 * Refund was frozen while the first was still open and the first is rejected
 * afterwards, which is the sequence below. A test in the checklist's order
 * (reject the first Refund, then create the second) passes with or without the
 * fix and proves nothing.
 *
 * Why Postgres and not the JS fake escrow.test.ts uses: the figure that matters
 * is the ESCROW_HOLD balance read back out of the ledger the way a Payout reads
 * it, after a real createRefund, rejectRefund, approveRefund and sweep have each
 * posted their own legs. A fake that hands the sweep its own idea of the freeze
 * would only prove the fake.
 *
 * Setup and skip behaviour follow refund-reject-fail-real-db.test.ts: a
 * throwaway database migrated by replaying every migration, `@/lib/prisma`
 * mocked to a real client, and a visible skip (not a green pass) when
 * TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Escrow sweep after a rejected Refund -- against real Postgres (prd-compliance 51)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[escrow sweep refund fee share] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `escrow_sweep_fee_share_${process.pid}`;
  let prisma: PrismaClient;
  let refunds: typeof import('@/lib/money/refunds');
  let ledger: typeof import('@/lib/money/ledger');
  let escrow: typeof import('@/lib/money/escrow');

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
    escrow = await import('@/lib/money/escrow');
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
    return { id, ownerId };
  }

  // Fees that do not divide evenly, so each Refund's share is rounded up and
  // the cumulative cap (the fee a Payment carries is never recognised twice)
  // has something to cut: half of 3_333 is 1_666.5, half of 1_667 is 833.5.
  const GROSS = 100_000;
  const PROVIDER_FEE = 3_333;
  const PLATFORM_FEE = 1_667;

  /** A PAID Payment settled into ESCROW_HOLD whose hold matured yesterday, so the sweep will consider it. */
  async function seedMaturedPayment(campaignId: string) {
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
        escrowReleaseAt: new Date(Date.now() - MS_PER_DAY),
      },
    });
    await prisma.$transaction((tx) =>
      ledger.postTransaction(
        tx,
        ledger.paymentSettledLegs({
          subject: { type: 'campaign', campaignId },
          grossAmount: GROSS,
          providerFee: PROVIDER_FEE,
          platformFee: PLATFORM_FEE,
        }),
        { paymentId: payment.id },
      ),
    );
    return payment;
  }

  function request(campaignId: string, paymentId: string, by: string, amount: number) {
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

  /** The debit legs a Refund's freeze posted, as account -> amount: what it took from ESCROW_HOLD and the two fee shares. */
  async function postedFreeze(refundId: string): Promise<Record<string, number>> {
    const legs = await prisma.ledgerEntry.findMany({
      where: { refundId, transactionId: `refund-requested-${refundId}`, direction: 'DEBIT' },
      select: { account: true, amount: true },
    });
    return Object.fromEntries(legs.map((l) => [l.account, l.amount]));
  }

  it('releases exactly what the later Refund left in Escrow Hold when an earlier Refund is rejected after it was frozen', async () => {
    const campaign = await makeCampaign();
    const payment = await seedMaturedPayment(campaign.id);
    const requester = await makeUser();
    const rejecter = await makeUser();
    const approver = await makeUser();

    // Two partial Refunds of the same Payment, both open at once. The second is
    // frozen with the first still counted against the fee cap, so it carries the
    // cut share: 833 of the Platform Fee and 1_666 of the Provider Fee, where the
    // first took the rounded-up 834 and 1_667. Its freeze debits ESCROW_HOLD
    // 50_000 - 833 - 1_666 = 47_501.
    const first = await request(campaign.id, payment.id, requester, 50_000);
    const second = await request(campaign.id, payment.id, requester, 50_000);
    expect(await postedFreeze(second.id)).toEqual({ ESCROW_HOLD: 47_501, PLATFORM_FEE: 833, REFUND_COST: 1_666 });

    // The first is rejected, so only the second stands: its earlier-Refund set is
    // now empty, and the fee shares computed from it would be 834 and 1_667.
    await refunds.rejectRefund(prisma, { refundId: first.id, rejectedById: rejecter, reason: 'Salah Payment' });
    // Approved so the sweep no longer defers on an open Refund.
    await refunds.approveRefund(prisma, { refundId: second.id, approvedById: approver, ...destination });

    const swept = await escrow.releaseMaturedEscrow({ type: 'campaign', id: campaign.id });

    expect(swept.releasedCount).toBe(1);
    // Settlement put 95_000 in ESCROW_HOLD and the second Refund's freeze took
    // 47_501 of it, so 47_499 was left to release. Releasing 47_501 instead
    // leaves ESCROW_HOLD at -2 and the withdrawable balance two rupiah above
    // what the Payment ever credited.
    expect(await ledger.escrowBalance(prisma, campaign.id)).toBe(0);
    expect(await ledger.campaignBalance(prisma, campaign.id)).toBe(47_499);
  }, 60_000);
});
