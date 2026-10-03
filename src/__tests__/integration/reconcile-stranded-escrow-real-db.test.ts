// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { LedgerSubject } from '@/lib/money/ledger';

/**
 * The reconciliation report's strandedEscrow and mismatches checks, on the
 * books a Refund that ended without paying the Donor really leaves behind
 * (prd-compliance 52), against a REAL Postgres.
 *
 * A Refund freezes its share of a Payment's Escrow Hold; reject and fail post
 * that freeze straight back (prd-compliance 49), and when the Payment's escrow
 * was released in the meantime they release the returned share too. The books
 * come out right. Until prd-compliance 52 the report read the freeze's debit
 * as money "refunded" whatever the Refund's fate, so it reported every such
 * Payment as stranded, with a negative residual, on every run; and it counted
 * the credit that handed the freeze back as money the Campaign was credited
 * with, so the Campaign's collectedAmount fell short of its ledger by exactly
 * that share, on every run. Alarms an Admin could do nothing about, because
 * nothing was wrong.
 *
 * What a JS fake cannot prove is that the journals the money layer actually
 * posts have the shape the report is read against. So these tests drive
 * createRefund, approveRefund, rejectRefund, failRefund and the escrow sweep
 * for real, and then ask the route itself. Same setup as
 * refund-reject-fail-real-db.test.ts: a throwaway database migrated by
 * replaying every migration, and a visible skip when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

type StrandedRow = {
  paymentId: string;
  creditedNet: number;
  releasedAmount: number;
  refundedAmount: number;
  residual: number;
} & ({ campaignId: string } | { volunteerTripId: string });

describe.skipIf(!DATABASE_URL)('Reconcile report on a Refund that ended without paying the Donor -- against real Postgres (prd-compliance 52)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[reconcile stranded escrow] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it.",
    );
  }

  const databaseName = `reconcile_stranded_${process.pid}`;
  let prisma: PrismaClient;
  let refunds: typeof import('@/lib/money/refunds');
  let ledger: typeof import('@/lib/money/ledger');
  let escrow: typeof import('@/lib/money/escrow');
  let GET: typeof import('@/app/api/admin/reconcile/route').GET;

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
    // The route is ADMIN-only; the session is the one thing about it that is
    // not under test here.
    vi.doMock('@/lib/auth', () => ({
      getServerSession: async () => ({ user: { id: 'admin-reconcile', assignments: ['ADMIN'] } }),
    }));
    refunds = await import('@/lib/money/refunds');
    ledger = await import('@/lib/money/ledger');
    escrow = await import('@/lib/money/escrow');
    ({ GET } = await import('@/app/api/admin/reconcile/route'));
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

  /**
   * One Payment per subject, with its fees and its Refund written out as
   * literals: the Net is what paymentSettledLegs credits to ESCROW_HOLD (Gross
   * less BOTH fees), and a Trip Fee carries no Platform Fee (CONTEXT.md, Trip
   * Fee). A partial Refund, so the Payment still has money left for the sweep
   * to release around it.
   */
  const FIGURES = {
    campaign: { gross: 300_000, providerFee: 15_000, platformFee: 7_500, net: 277_500, refundAmount: 100_000 },
    trip: { gross: 500_000, providerFee: 25_000, platformFee: 0, net: 475_000, refundAmount: 200_000 },
  } as const;

  type Seeded = { subject: LedgerSubject; subjectId: string; paymentId: string; net: number; refundAmount: number };

  /** A PAID Payment settled into ESCROW_HOLD, its hold already matured and nothing released yet. */
  async function seed(kind: 'campaign' | 'trip'): Promise<Seeded> {
    const figures = FIGURES[kind];
    const matured = new Date(Date.now() - MS_PER_DAY);
    const common = {
      provider: 'mock',
      method: 'bank_transfer',
      providerRef: `ref-${process.pid}-${next()}`,
      amount: figures.gross,
      providerFee: figures.providerFee,
      platformFee: figures.platformFee,
      status: 'PAID' as const,
      escrowReleaseAt: matured,
    };

    let subject: LedgerSubject;
    let subjectId: string;
    let paymentId: string;
    if (kind === 'campaign') {
      const ownerId = await makeUser();
      const campaignId = `campaign-${process.pid}-${next()}`;
      await prisma.campaign.create({
        data: {
          id: campaignId,
          slug: campaignId,
          title: `Campaign ${campaignId}`,
          description: 'd',
          story: 's',
          coverImage: 'https://example.com/c.jpg',
          targetAmount: 10_000_000,
          category: 'Zakat Maal',
          kind: 'DONATION',
          creatorId: ownerId,
          lifecycleStatus: 'ACTIVE',
          // The settlement webhook increments this by the Payment's Gross.
          collectedAmount: figures.gross,
        },
      });
      const donationId = `donation-${process.pid}-${next()}`;
      await prisma.donation.create({ data: { id: donationId, amount: figures.gross, paymentMethod: 'bank_transfer', campaignId } });
      paymentId = (await prisma.payment.create({ data: { ...common, donationId } })).id;
      subject = { type: 'campaign', campaignId };
      subjectId = campaignId;
    } else {
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
          tripFeeAmount: figures.gross,
          status: 'ACTIVE',
          fundraiserId,
        },
      });
      const batch = await prisma.volunteerBatch.create({
        data: {
          tripId: trip.id,
          startDate: new Date(Date.now() + 30 * MS_PER_DAY),
          endDate: new Date(Date.now() + 33 * MS_PER_DAY),
          registrationDeadline: new Date(Date.now() + 25 * MS_PER_DAY),
          maxQuota: 5,
          minQuota: 1,
        },
      });
      const registration = await prisma.registration.create({
        data: { volunteerId: await makeUser(), batchId: batch.id, status: 'CONFIRMED', holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000) },
      });
      paymentId = (await prisma.payment.create({ data: { ...common, registrationId: registration.id } })).id;
      subject = { type: 'trip', tripId: trip.id };
      subjectId = trip.id;
    }

    await prisma.$transaction((tx) =>
      ledger.postTransaction(
        tx,
        ledger.paymentSettledLegs({
          subject,
          grossAmount: figures.gross,
          providerFee: figures.providerFee,
          platformFee: figures.platformFee,
        }),
        { paymentId },
      ),
    );
    return { subject, subjectId, paymentId, net: figures.net, refundAmount: figures.refundAmount };
  }

  function request(seeded: Seeded, requestedById: string) {
    return prisma.$transaction((tx) =>
      refunds.createRefund(tx, {
        subject: seeded.subject,
        paymentId: seeded.paymentId,
        amount: seeded.refundAmount,
        reason: 'salah bayar',
        requestedById,
      }),
    );
  }

  const destination = { donorBankCode: 'BCA', donorAccountName: 'Budi Santoso', donorAccountNumber: '1234567890' };

  /** The sweep for this one subject, asserted to have released the Payment: a sweep that quietly did nothing would leave nothing to report on. */
  async function sweep(seeded: Seeded): Promise<void> {
    const result = await escrow.releaseMaturedEscrow(
      seeded.subject.type === 'campaign'
        ? { type: 'campaign', id: seeded.subject.campaignId }
        : { type: 'trip', id: seeded.subject.tripId },
    );
    expect(result.releasedCount).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: seeded.paymentId } })).escrowReleasedAt).not.toBeNull();
  }

  /** Net signed (credit +, debit -) of one account, over the entries scoped to this subject. */
  async function accountNet(account: string, scope: { campaignId: string } | { volunteerTripId: string }): Promise<number> {
    const rows = await prisma.ledgerEntry.findMany({
      where: { account: account as never, ...scope },
      select: { direction: true, amount: true },
    });
    return rows.reduce((sum, r) => sum + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
  }

  /** The subject's own three accounts: where the escrow, the withdrawable money and a Refund's freeze stand. */
  async function books(subject: LedgerSubject) {
    const scope = subject.type === 'campaign' ? { campaignId: subject.campaignId } : { volunteerTripId: subject.tripId };
    return {
      escrow: await accountNet('ESCROW_HOLD', scope),
      withdrawable: await accountNet(subject.type === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE', scope),
      frozen: await accountNet('FROZEN_BALANCE', scope),
    };
  }

  type Report = {
    strandedEscrow: StrandedRow[];
    tripStrandedEscrow: StrandedRow[];
    mismatches: Array<{
      campaignId: string;
      campaignTitle: string;
      collectedAmount: number;
      ledgerAmount: number;
      difference: number;
    }>;
  };

  async function getReport(): Promise<Report> {
    const response = await GET(new NextRequest('http://localhost:3000/api/admin/reconcile'));
    expect(response.status).toBe(200);
    return (await response.json()) as Report;
  }

  /** What the route says about ONE Payment: the database is shared by every test in this file. */
  async function reportedFor(paymentId: string): Promise<Pick<Report, 'strandedEscrow' | 'tripStrandedEscrow'>> {
    const report = await getReport();
    return {
      strandedEscrow: report.strandedEscrow.filter((r) => r.paymentId === paymentId),
      tripStrandedEscrow: report.tripStrandedEscrow.filter((r) => r.paymentId === paymentId),
    };
  }

  /** What it says about ONE Campaign's collectedAmount against its ledger. */
  async function mismatchesFor(campaignId: string): Promise<Report['mismatches']> {
    return (await getReport()).mismatches.filter((m) => m.campaignId === campaignId);
  }

  /**
   * The three ways a Refund ends without paying the Donor, each with the
   * escrow sweep landing where it really can. REQUESTED defers the sweep, so a
   * Refund rejected from it can only be released AFTER the rejection; a Refund
   * that has left REQUESTED (APPROVED, or AWAITING_DONOR_DETAILS) does not,
   * so the sweep releases the Payment around it and the reversal then has to
   * release the returned share itself (resolveRefund).
   */
  const endings: Array<{ name: string; run: (seeded: Seeded) => Promise<void> }> = [
    {
      name: 'rejected before the sweep',
      run: async (seeded) => {
        const refund = await request(seeded, await makeUser());
        await refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: await makeUser(), reason: 'Salah Payment' });
        await sweep(seeded);
      },
    },
    {
      name: 'rejected after the sweep',
      run: async (seeded) => {
        const refund = await request(seeded, await makeUser());
        // The only status other than REQUESTED a Refund can be rejected from.
        // Nothing in the app writes it yet (refunds.ts keeps it in the enum for
        // a later rilis), so it is set the way that rilis would.
        await prisma.refund.update({ where: { id: refund.id }, data: { status: 'AWAITING_DONOR_DETAILS' } });
        await sweep(seeded);
        await refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: await makeUser(), reason: 'Salah Payment' });
      },
    },
    {
      name: 'failed after the sweep',
      run: async (seeded) => {
        const refund = await request(seeded, await makeUser());
        await refunds.approveRefund(prisma, { refundId: refund.id, approvedById: await makeUser(), ...destination });
        await sweep(seeded);
        await refunds.failRefund(prisma, { refundId: refund.id, failedById: await makeUser(), reason: 'Rekening Donor ditutup' });
      },
    },
  ];

  describe.each(['campaign', 'trip'] as const)('a %s Payment', (kind) => {
    it.each(endings)('whose Refund was $name is not reported as stranded: the books are right', async ({ run }) => {
      const seeded = await seed(kind);

      await run(seeded);

      // The books first: every rupiah is the subject's, withdrawable, exactly
      // as if the Refund had never been asked for. So anything the report says
      // about this Payment is a false alarm.
      expect(await books(seeded.subject)).toEqual({ escrow: 0, withdrawable: seeded.net, frozen: 0 });
      expect(await reportedFor(seeded.paymentId)).toEqual({ strandedEscrow: [], tripStrandedEscrow: [] });
    }, 60_000);
  });

  describe('a campaign whose Refund ended without paying the Donor', () => {
    it.each(endings)('whose Refund was $name still adds up to its collectedAmount', async ({ run }) => {
      const seeded = await seed('campaign');

      await run(seeded);

      // collectedAmount is the lifetime-raised figure the public pages show, and
      // no Refund writes it: the Donor paid 300_000 and none of it went back, so
      // 300_000 is right. The ledger agrees: every rupiah is the Campaign's and
      // withdrawable, so a mismatch can only be the report adding the ledger up
      // wrongly.
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: seeded.subjectId } })).collectedAmount).toBe(300_000);
      expect(await books(seeded.subject)).toEqual({ escrow: 0, withdrawable: seeded.net, frozen: 0 });
      expect(await mismatchesFor(seeded.subjectId)).toEqual([]);
    }, 60_000);

    it('still reports a collectedAmount that really is off, by exactly how far, with a rejected Refund on the Campaign', async () => {
      const seeded = await seed('campaign');
      const refund = await request(seeded, await makeUser());
      await refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: await makeUser(), reason: 'Salah Payment' });
      // 10_000 more than the 300_000 the Payment settled.
      await prisma.campaign.update({ where: { id: seeded.subjectId }, data: { collectedAmount: 310_000 } });

      expect(await mismatchesFor(seeded.subjectId)).toEqual([
        {
          campaignId: seeded.subjectId,
          campaignTitle: `Campaign ${seeded.subjectId}`,
          collectedAmount: 310_000,
          ledgerAmount: 300_000,
          difference: 10_000,
        },
      ]);
    }, 60_000);
  });

  it('still reports a Payment whose escrow really is stranded, at its full size, with a rejected Refund on it', async () => {
    // The stranding this report exists for (the escrow.ts bug its doc comment
    // names): the Payment stamped released with nothing posted for it. The
    // rejected Refund's freeze was mirrored out, so none of the Payment's net
    // went to a Refund and all of it is still in ESCROW_HOLD: the residual is
    // the whole net. With the reversed freeze counted as refunded it would be
    // the net less that freeze, a smaller stranding than the one there is.
    const seeded = await seed('campaign');
    const refund = await request(seeded, await makeUser());
    await refunds.rejectRefund(prisma, { refundId: refund.id, rejectedById: await makeUser(), reason: 'Salah Payment' });
    await prisma.payment.update({ where: { id: seeded.paymentId }, data: { escrowReleasedAt: new Date() } });

    const reported = await reportedFor(seeded.paymentId);

    expect(reported.tripStrandedEscrow).toEqual([]);
    expect(reported.strandedEscrow).toEqual([
      {
        paymentId: seeded.paymentId,
        campaignId: seeded.subjectId,
        creditedNet: 277_500,
        releasedAmount: 0,
        refundedAmount: 0,
        residual: 277_500,
      },
    ]);
  }, 60_000);
});
