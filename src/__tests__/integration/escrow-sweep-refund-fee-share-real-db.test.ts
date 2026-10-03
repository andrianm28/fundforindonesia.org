// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * A Refund's fee shares are read off its freeze, never worked out again, by the
 * escrow sweep and by approval (prd-compliance 51), against a REAL Postgres.
 *
 * createRefund (src/lib/money/refunds.ts) splits a Refund once, against the
 * Refunds that stood before it at that moment, and posts the split as the
 * Refund's freeze. Two later steps need it again: the sweep (releaseMaturedEscrow,
 * src/lib/money/escrow.ts) to know how much of a Payment's Net each live Refund
 * took out of ESCROW_HOLD, and approveRefund to know how much of the pool the
 * Refund took, so the platform covers exactly what a Payout already spent.
 * Working the split out again from the Refunds still standing gives the same
 * figure only while every Refund was split against the same set of earlier
 * Refunds that stands now, and rejecting or failing a Refund (prd-compliance 49)
 * is what makes that stop being true. So both have to read the posted entries.
 *
 * ORDER MATTERS, and it is not the order the ticket's checklist lists
 * (.scratch/prd-compliance-fase-0-2/issues/51). A Refund rejected BEFORE the
 * second one is created never disagrees: createRefund leaves rejected Refunds
 * out of the earlier-Refund set at creation, so the freeze and any later
 * recomputation start from the same set. The set differs only when the second
 * Refund was frozen while the first was still open and the first is rejected
 * (or failed) afterwards, which is the sequence below. A test in the checklist's
 * order (reject the first Refund, then create the second) passes with or without
 * the fix and proves nothing.
 *
 * Why Postgres and not the JS fakes escrow.test.ts and refunds.test.ts use: the
 * figures that matter are the ESCROW_HOLD and CAMPAIGN_BALANCE balances and the
 * REFUND_COST total read back out of the ledger the way a Payout and the Impact
 * page read them, after a real createRefund, rejectRefund, failRefund,
 * approveRefund and sweep have each posted their own legs. A fake that hands
 * them its own idea of the freeze would only prove the fake.
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

describe.skipIf(!DATABASE_URL)('A Refund reads its fee shares off its freeze -- against real Postgres (prd-compliance 51)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[refund fee share] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
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

  /** The debit legs one of a Refund's postings made, as account -> amount. */
  async function postedDebits(refundId: string, transactionId: string): Promise<Record<string, number>> {
    const legs = await prisma.ledgerEntry.findMany({
      where: { refundId, transactionId, direction: 'DEBIT' },
      select: { account: true, amount: true },
    });
    return Object.fromEntries(legs.map((l) => [l.account, l.amount]));
  }

  /** What a Refund's freeze posted: what it took from the pool it was frozen against, and the two fee shares. */
  const postedFreeze = (refundId: string) => postedDebits(refundId, `refund-requested-${refundId}`);

  /** What a Refund's approval posted: the FROZEN_BALANCE it closed and any shortfall it covered. */
  const postedApproval = (refundId: string) => postedDebits(refundId, `refund-approved-${refundId}`);

  /** What these Refunds cost the platform in REFUND_COST: debits less credits over the entries they posted. */
  async function refundCostOf(refundIds: string[]): Promise<number> {
    const legs = await prisma.ledgerEntry.findMany({
      where: { account: 'REFUND_COST', refundId: { in: refundIds } },
      select: { direction: true, amount: true },
    });
    return legs.reduce((sum, l) => sum + (l.direction === 'DEBIT' ? l.amount : -l.amount), 0);
  }

  const NET = GROSS - PROVIDER_FEE - PLATFORM_FEE;

  /**
   * A PAID Payment whose hold matured and was released to the withdrawable
   * balance, and whose whole Net a Payout then took out: the empty pool a later
   * Refund finds. The release goes through the sweep, so escrowReleasedAt is
   * stamped the way production stamps it; the Payout is its ledger posting
   * (payoutInstructedLegs), which is what draws CAMPAIGN_BALANCE down.
   */
  async function seedPaymentDrainedByPayout(campaignId: string) {
    const payment = await seedMaturedPayment(campaignId);
    const released = await escrow.releaseMaturedEscrow({ type: 'campaign', id: campaignId });
    expect(released.releasedCount).toBe(1);
    await prisma.$transaction((tx) =>
      ledger.postTransaction(tx, ledger.payoutInstructedLegs({ subject: { type: 'campaign', campaignId }, amount: NET })),
    );
    return payment;
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

  it('counts a Refund failed after approval as having taken nothing, the same as a rejected one', async () => {
    const campaign = await makeCampaign();
    const payment = await seedMaturedPayment(campaign.id);
    const requester = await makeUser();
    const approver = await makeUser();
    const failer = await makeUser();

    // The same two Refunds open at once, which froze 47_499 and 47_501 out of
    // ESCROW_HOLD. Both are approved, so the sweep does not defer on an open
    // Refund, and then the first fails: its freeze and its approval are mirrored
    // back, so only the second Refund's 47_501 is still out of the hold.
    const first = await request(campaign.id, payment.id, requester, 50_000);
    const second = await request(campaign.id, payment.id, requester, 50_000);
    await refunds.approveRefund(prisma, { refundId: first.id, approvedById: approver, ...destination });
    await refunds.approveRefund(prisma, { refundId: second.id, approvedById: approver, ...destination });
    await refunds.failRefund(prisma, { refundId: first.id, failedById: failer, reason: 'Rekening Donor ditutup' });

    const swept = await escrow.releaseMaturedEscrow({ type: 'campaign', id: campaign.id });

    expect(swept.releasedCount).toBe(1);
    // 95_000 settled, less the second Refund's 47_501, is 47_499 to release.
    // Counting the failed Refund's freeze as taken too would release nothing and
    // strand 47_499 in ESCROW_HOLD; working the shares out again from the Refunds
    // that stand would release 47_501 and leave it at -2.
    expect(await ledger.escrowBalance(prisma, campaign.id)).toBe(0);
    expect(await ledger.campaignBalance(prisma, campaign.id)).toBe(47_499);
  }, 60_000);

  async function makeTrip(): Promise<{ id: string; fundraiserId: string }> {
    const fundraiserId = await makeUser();
    const trip = await prisma.volunteerTrip.create({
      data: {
        slug: `trip-${process.pid}-${next()}`,
        title: 'T',
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        destination: 'x',
        itinerary: 'i',
        tripFeeAmount: GROSS,
        status: 'ACTIVE',
        fundraiserId,
      },
    });
    return { id: trip.id, fundraiserId };
  }

  /**
   * A PAID Trip Fee Payment settled into the Trip's ESCROW_HOLD whose hold
   * matured yesterday. A Trip Fee carries no Platform Fee (CONTEXT.md, Trip
   * Fee), only the Provider Fee.
   */
  async function seedMaturedTripPayment(tripId: string) {
    const batch = await prisma.volunteerBatch.create({
      data: {
        tripId,
        startDate: new Date(Date.now() + 30 * MS_PER_DAY),
        endDate: new Date(Date.now() + 33 * MS_PER_DAY),
        registrationDeadline: new Date(Date.now() + 25 * MS_PER_DAY),
        maxQuota: 5,
        minQuota: 1,
      },
    });
    const registration = await prisma.registration.create({
      data: {
        volunteerId: await makeUser(),
        batchId: batch.id,
        status: 'CONFIRMED',
        holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: GROSS,
        providerFee: PROVIDER_FEE,
        status: 'PAID',
        escrowReleaseAt: new Date(Date.now() - MS_PER_DAY),
      },
    });
    await prisma.$transaction((tx) =>
      ledger.postTransaction(
        tx,
        ledger.paymentSettledLegs({ subject: { type: 'trip', tripId }, grossAmount: GROSS, providerFee: PROVIDER_FEE }),
        { paymentId: payment.id },
      ),
    );
    return payment;
  }

  function requestForTrip(tripId: string, paymentId: string, by: string, amount: number) {
    return prisma.$transaction((tx) =>
      refunds.createRefund(tx, {
        subject: { type: 'trip', tripId },
        paymentId,
        amount,
        reason: 'Batch dibatalkan',
        requestedById: by,
      }),
    );
  }

  it('reads a Volunteer Trip Payment the same way: it releases to TRIP_BALANCE what the later Refund left in Escrow Hold', async () => {
    const trip = await makeTrip();
    const payment = await seedMaturedTripPayment(trip.id);
    const requester = await makeUser();
    const rejecter = await makeUser();
    const approver = await makeUser();

    // No Platform Fee, so only the Provider Fee is split: 3_333 over two 50_000
    // Refunds is 1_666.5 each. The first takes the rounded-up 1_667 and debits
    // ESCROW_HOLD 50_000 - 1_667 = 48_333; the second, frozen with the first still
    // counted, is capped at the 1_666 the Payment has left and debits 48_334.
    const first = await requestForTrip(trip.id, payment.id, requester, 50_000);
    const second = await requestForTrip(trip.id, payment.id, requester, 50_000);
    expect(await postedFreeze(first.id)).toEqual({ ESCROW_HOLD: 48_333, REFUND_COST: 1_667 });
    expect(await postedFreeze(second.id)).toEqual({ ESCROW_HOLD: 48_334, REFUND_COST: 1_666 });

    await refunds.rejectRefund(prisma, { refundId: first.id, rejectedById: rejecter, reason: 'Salah Payment' });
    await refunds.approveRefund(prisma, { refundId: second.id, approvedById: approver, ...destination });

    const swept = await escrow.releaseMaturedEscrow({ type: 'trip', id: trip.id });

    expect(swept.releasedCount).toBe(1);
    // 96_667 settled, less the second Refund's 48_334, is 48_333 to release.
    // Working the share out again would give 1_667 and release 48_334, leaving
    // ESCROW_HOLD at -1.
    expect(await ledger.tripEscrowBalance(prisma, trip.id)).toBe(0);
    expect(await ledger.tripBalance(prisma, trip.id)).toBe(48_333);
  }, 60_000);

  it.each([
    { outcome: 'rejected', ending: 'reject' },
    { outcome: 'failed after approval', ending: 'fail' },
  ] as const)(
    'covers the whole net share the later Refund froze when a Payout drained the pool and an earlier Refund is $outcome',
    async ({ ending }) => {
      const campaign = await makeCampaign();
      const payment = await seedPaymentDrainedByPayout(campaign.id);
      expect(await ledger.campaignBalance(prisma, campaign.id)).toBe(0);
      const requester = await makeUser();
      const rejecter = await makeUser();
      const approver = await makeUser();
      const failer = await makeUser();

      // The pool is empty, so each freeze takes the withdrawable balance further
      // below zero. The second is frozen with the first still counted against the
      // fee cap, so it carries the cut shares (833 and 1_666) and debits
      // 50_000 - 833 - 1_666 = 47_501, where the first debited 47_499.
      const first = await request(campaign.id, payment.id, requester, 50_000);
      const second = await request(campaign.id, payment.id, requester, 50_000);
      expect(await postedFreeze(first.id)).toEqual({ CAMPAIGN_BALANCE: 47_499, PLATFORM_FEE: 834, REFUND_COST: 1_667 });
      expect(await postedFreeze(second.id)).toEqual({ CAMPAIGN_BALANCE: 47_501, PLATFORM_FEE: 833, REFUND_COST: 1_666 });
      expect(await ledger.campaignBalance(prisma, campaign.id)).toBe(-95_000);

      // The first Refund ends without paying anyone, and its freeze goes back.
      // Only the second Refund's freeze still stands, so its earlier-Refund set
      // is now empty and the fee shares computed from it would be 834 and 1_667.
      if (ending === 'reject') {
        await refunds.rejectRefund(prisma, { refundId: first.id, rejectedById: rejecter, reason: 'Salah Payment' });
      } else {
        await refunds.approveRefund(prisma, { refundId: first.id, approvedById: approver, ...destination });
        await refunds.failRefund(prisma, { refundId: first.id, failedById: failer, reason: 'Rekening Donor ditutup' });
      }
      expect(await ledger.campaignBalance(prisma, campaign.id)).toBe(-47_501);

      await refunds.approveRefund(prisma, { refundId: second.id, approvedById: approver, ...destination });

      // The Payout already spent the Net, so the 47_501 the second Refund froze
      // is entirely the platform's to cover: the approval tops the pool up by
      // exactly that and books it as REFUND_COST. Covering 47_499, which is what
      // recomputing the shares gives, leaves the balance at -2 and REFUND_COST
      // two rupiah short.
      expect(await ledger.campaignBalance(prisma, campaign.id)).toBe(0);
      // REFUND_COST over both Refunds: the second's Provider Fee share at freeze
      // (1_666) plus the shortfall (47_501). The first's entries cancel out.
      expect(await refundCostOf([first.id, second.id])).toBe(49_167);
      expect(await postedApproval(second.id)).toEqual({ FROZEN_BALANCE: 50_000, REFUND_COST: 47_501 });
    },
    60_000,
  );
});
