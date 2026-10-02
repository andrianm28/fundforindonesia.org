// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { InsufficientBalanceError } from '@/lib/money/errors';
import { TripPayoutFundsNotCompletedError } from '@/lib/volunteer-trip-errors';

/**
 * Ticket 49 (owner decision 2026-10-02): a Trip Fee Payout may only spend
 * money of COMPLETED Batches. Against a REAL Postgres, because the guarantee
 * is the Trip row lock that Payout request/approval, completeBatch and
 * cancelBatch all take, and the held-balance read is a join across Ledger,
 * Payment, Registration and Batch that a mock cannot prove. Same setup as
 * volunteer-registration-concurrency.test.ts.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Trip Fee Payout only from COMPLETED Batches -- against real Postgres (ticket 49)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[trip payout after completion] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `trip_payout_completion_${process.pid}`;
  let prisma: PrismaClient;
  let requestPayout: typeof import('@/lib/money/payouts').requestPayout;
  let approvePayout: typeof import('@/lib/money/payouts').approvePayout;
  let completeBatch: typeof import('@/lib/volunteer/trip').completeBatch;
  let cancelBatch: typeof import('@/lib/volunteer/trip').cancelBatch;
  let completePayout: typeof import('@/lib/money/payouts').completePayout;
  let tripBalance: typeof import('@/lib/money/ledger').tripBalance;
  let tripWithdrawableBalance: typeof import('@/lib/money/trip-payout-funds').tripWithdrawableBalance;

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
    ({ requestPayout, approvePayout, completePayout } = await import('@/lib/money/payouts'));
    ({ tripBalance } = await import('@/lib/money/ledger'));
    ({ completeBatch, cancelBatch } = await import('@/lib/volunteer/trip'));
    ({ tripWithdrawableBalance } = await import('@/lib/money/trip-payout-funds'));
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
      data: {
        id,
        name: 'Test',
        emailHmac: `${id}-hmac`,
        emailHmacKeyId: 'k',
        emailCiphertext: `${id}-c`,
        emailKeyId: 'k',
      },
    });
    return id;
  }

  async function makeTrip() {
    const fundraiserId = await makeUser();
    const bank = await prisma.bankAccount.create({
      data: {
        ownerId: fundraiserId,
        bankCode: 'BCA',
        accountNumberCiphertext: 'c',
        accountNumberKeyId: 'k',
        accountName: 'Fundraiser',
        verifiedAt: new Date(),
      },
    });
    const trip = await prisma.volunteerTrip.create({
      data: {
        slug: `trip-${process.pid}-${next()}`,
        title: 'T',
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        destination: 'x',
        itinerary: 'i',
        tripFeeAmount: 500_000,
        status: 'ACTIVE',
        fundraiserId,
      },
    });
    return { tripId: trip.id, fundraiserId, bankAccountId: bank.id };
  }

  /** A Batch of the Trip with one CONFIRMED, paid Registration whose Trip Fee already left Escrow Hold for TRIP_BALANCE. */
  async function makeBatchWithMoney(
    tripId: string,
    opts: { ended: boolean; fee?: number; minQuota?: number; status?: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'COMPLETED' },
  ) {
    const fee = opts.fee ?? 500_000;
    const offset = opts.ended ? -10 : 30;
    const batch = await prisma.volunteerBatch.create({
      data: {
        tripId,
        startDate: new Date(Date.now() + offset * MS_PER_DAY),
        endDate: new Date(Date.now() + (offset + 3) * MS_PER_DAY),
        registrationDeadline: new Date(Date.now() + (offset - 5) * MS_PER_DAY),
        maxQuota: 5,
        minQuota: opts.minQuota ?? 1,
        ...(opts.status ? { status: opts.status } : {}),
      },
    });
    const volunteerId = await makeUser();
    const registration = await prisma.registration.create({
      data: { volunteerId, batchId: batch.id, status: 'CONFIRMED', holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const payment = await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: fee,
        status: 'PAID',
        paidAt: new Date(),
        settledAt: new Date(),
        // Escrow already matured: a later Refund therefore debits TRIP_BALANCE, not ESCROW_HOLD.
        escrowReleasedAt: new Date(),
      },
    });
    const transactionId = `release-${payment.id}`;
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId, legIndex: 0, account: 'TRIP_BALANCE', direction: 'CREDIT', amount: fee, volunteerTripId: tripId, paymentId: payment.id },
        { transactionId, legIndex: 1, account: 'ESCROW_HOLD', direction: 'DEBIT', amount: fee, volunteerTripId: tripId, paymentId: payment.id },
      ],
    });
    return { batchId: batch.id, registrationId: registration.id, paymentId: payment.id };
  }

  const request = (t: { tripId: string; fundraiserId: string; bankAccountId: string }, amount: number) =>
    prisma.$transaction((tx) =>
      requestPayout(tx, {
        subject: { type: 'trip', tripId: t.tripId },
        requestedById: t.fundraiserId,
        bankAccountId: t.bankAccountId,
        amount,
        description: 'Pencairan Trip Fee',
      }),
    );

  const finish = (t: { tripId: string; fundraiserId: string }, batchId: string) =>
    completeBatch(prisma, { tripId: t.tripId, batchId, actor: { userId: t.fundraiserId, assignments: [] }, attendedRegistrationIds: [] });

  const approve = async (payoutId: string) =>
    approvePayout(prisma, { payoutId, approvedById: await makeUser(), provider: 'sumopod', providerBalance: 5_000_000 });

  const complete = async (payoutId: string) =>
    completePayout(prisma, {
      payoutId,
      completedById: await makeUser(),
      proofReference: 'TRX-49',
      proofNote: 'Ditransfer via BCA, dicocokkan dengan nominal dan rekening tujuan.',
    });

  /** A COMPLETED Refund of `amount` out of the Payment's money, posted as the real freeze does once escrow has matured. */
  async function seedPartialRefund(t: { tripId: string; fundraiserId: string }, paymentId: string, amount: number) {
    const refund = await prisma.refund.create({
      data: { paymentId, amount, reason: 'x', status: 'COMPLETED', requestedById: t.fundraiserId },
    });
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId: `refund-${refund.id}`, legIndex: 0, account: 'TRIP_BALANCE', direction: 'DEBIT', amount, volunteerTripId: t.tripId, refundId: refund.id },
        { transactionId: `refund-${refund.id}`, legIndex: 1, account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount, refundId: refund.id },
      ],
    });
  }

  const cancel = (t: { tripId: string; fundraiserId: string }, batchId: string) =>
    cancelBatch(prisma, { tripId: t.tripId, batchId, actor: { userId: t.fundraiserId, assignments: [] } });

  const balanceOf = (tripId: string) => prisma.$transaction((tx) => tripBalance(tx, tripId));
  const withdrawableOf = (tripId: string) => prisma.$transaction((tx) => tripWithdrawableBalance(tx, tripId));

  it('refuses a Payout before the Batch is COMPLETED and allows it after, for the same amount', async () => {
    const t = await makeTrip();
    const { batchId } = await makeBatchWithMoney(t.tripId, { ended: true });

    await expect(request(t, 500_000)).rejects.toBeInstanceOf(TripPayoutFundsNotCompletedError);
    expect(await prisma.payout.count({ where: { volunteerTripId: t.tripId } })).toBe(0);

    await finish(t, batchId);

    await expect(request(t, 500_000)).resolves.toMatchObject({ status: 'DRAFT', amount: 500_000 });
  });

  it('caps a Trip with a COMPLETED and an OPEN Batch at the COMPLETED Batch money', async () => {
    const t = await makeTrip();
    const done = await makeBatchWithMoney(t.tripId, { ended: true, fee: 400_000 });
    await makeBatchWithMoney(t.tripId, { ended: false, fee: 300_000 });
    await finish(t, done.batchId);

    expect(await prisma.$transaction((tx) => tripWithdrawableBalance(tx, t.tripId))).toBe(400_000);
    await expect(request(t, 400_001)).rejects.toMatchObject({ code: 'TRIP_PAYOUT_FUNDS_NOT_COMPLETED', withdrawable: 400_000 });
    await expect(request(t, 400_000)).resolves.toMatchObject({ amount: 400_000 });
  });

  it('keeps what a partial Refund left in a Batch held until that Batch completes', async () => {
    const t = await makeTrip();
    const { paymentId } = await makeBatchWithMoney(t.tripId, { ended: false, fee: 500_000 });
    const refund = await prisma.refund.create({
      data: { paymentId, amount: 250_000, reason: 'x', status: 'COMPLETED', requestedById: t.fundraiserId },
    });
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId: `refund-${refund.id}`, legIndex: 0, account: 'TRIP_BALANCE', direction: 'DEBIT', amount: 250_000, volunteerTripId: t.tripId, refundId: refund.id },
        { transactionId: `refund-${refund.id}`, legIndex: 1, account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 250_000, refundId: refund.id },
      ],
    });

    // Balance is 250k, and all of it belongs to a Batch that has not completed.
    expect(await prisma.$transaction((tx) => tripWithdrawableBalance(tx, t.tripId))).toBe(0);
    await expect(request(t, 1)).rejects.toBeInstanceOf(TripPayoutFundsNotCompletedError);
  });

  it('never lets a Payout through while a Batch is being cancelled at the same time', async () => {
    for (let round = 0; round < 5; round++) {
      const t = await makeTrip();
      // Minimum quota not met, so the Fundraiser may cancel it. Escrow has matured, so the Refund debits TRIP_BALANCE.
      const { batchId } = await makeBatchWithMoney(t.tripId, { ended: false, minQuota: 5 });

      const [payout, cancelled] = await Promise.allSettled([request(t, 500_000), cancel(t, batchId)]);

      // Cancel first: the Refund already took the money, so nothing is left (InsufficientBalanceError).
      // Request first: the balance is there but belongs to a Batch that is not COMPLETED.
      expect(payout.status).toBe('rejected');
      const reason = (payout as PromiseRejectedResult).reason;
      expect(reason instanceof TripPayoutFundsNotCompletedError || reason instanceof InsufficientBalanceError).toBe(true);
      expect(cancelled.status).toBe('fulfilled');
      // No money of a Batch that was not COMPLETED left through a Payout.
      expect(await prisma.payout.count({ where: { volunteerTripId: t.tripId } })).toBe(0);
      expect(await balanceOf(t.tripId)).toBe(0);
    }
  });

  it('holds the money of a CANCELLED Batch, including what a partial Refund left, and lifts nothing for the COMPLETED one', async () => {
    const t = await makeTrip();
    const done = await makeBatchWithMoney(t.tripId, { ended: true, fee: 400_000 });
    const cancelled = await makeBatchWithMoney(t.tripId, { ended: false, fee: 500_000, status: 'CANCELLED' });
    await seedPartialRefund(t, cancelled.paymentId, 250_000);
    await finish(t, done.batchId);

    // Balance 650k: 400k of the COMPLETED Batch, 250k residue of the CANCELLED one, which is never COMPLETED.
    expect(await balanceOf(t.tripId)).toBe(650_000);
    expect(await withdrawableOf(t.tripId)).toBe(400_000);
    await expect(request(t, 400_001)).rejects.toMatchObject({ code: 'TRIP_PAYOUT_FUNDS_NOT_COMPLETED', withdrawable: 400_000 });
    await expect(request(t, 400_000)).resolves.toMatchObject({ amount: 400_000 });
  });

  it('holds all of a CANCELLED Batch residue when nothing else is COMPLETED', async () => {
    const t = await makeTrip();
    const cancelled = await makeBatchWithMoney(t.tripId, { ended: false, fee: 500_000, status: 'CANCELLED' });
    await seedPartialRefund(t, cancelled.paymentId, 100_000);

    expect(await withdrawableOf(t.tripId)).toBe(0);
    await expect(request(t, 1)).rejects.toBeInstanceOf(TripPayoutFundsNotCompletedError);
  });

  it('holds the money of a CLOSED Batch until it is COMPLETED, while a COMPLETED one stays withdrawable', async () => {
    const t = await makeTrip();
    const done = await makeBatchWithMoney(t.tripId, { ended: true, fee: 400_000 });
    await makeBatchWithMoney(t.tripId, { ended: false, fee: 300_000, status: 'CLOSED' });
    await finish(t, done.batchId);

    expect(await balanceOf(t.tripId)).toBe(700_000);
    expect(await withdrawableOf(t.tripId)).toBe(400_000);
    await expect(request(t, 400_001)).rejects.toMatchObject({ code: 'TRIP_PAYOUT_FUNDS_NOT_COMPLETED', withdrawable: 400_000 });
  });

  it('refuses a Payout from a Trip whose only money is in a CLOSED Batch', async () => {
    const t = await makeTrip();
    await makeBatchWithMoney(t.tripId, { ended: false, fee: 300_000, status: 'CLOSED' });
    await expect(request(t, 300_000)).rejects.toBeInstanceOf(TripPayoutFundsNotCompletedError);
  });

  it('approves a Payout drafted before cancelBatch: the Refunds of the cancelled Batch leave the COMPLETED money intact', async () => {
    const t = await makeTrip();
    const done = await makeBatchWithMoney(t.tripId, { ended: true, fee: 400_000 });
    const open = await makeBatchWithMoney(t.tripId, { ended: false, fee: 300_000, minQuota: 5 });
    await finish(t, done.batchId);
    const draft = await request(t, 400_000);

    await cancel(t, open.batchId);
    // The Refund of the cancelled Batch took its 300k out of TRIP_BALANCE.
    expect(await balanceOf(t.tripId)).toBe(400_000);

    await expect(approve(draft.id)).resolves.toMatchObject({ status: 'APPROVED' });
    expect(await balanceOf(t.tripId)).toBe(0);
  });

  it('approves a Payout after cancelBatch but leaves a CANCELLED Batch residue held', async () => {
    const t = await makeTrip();
    const done = await makeBatchWithMoney(t.tripId, { ended: true, fee: 400_000 });
    const open = await makeBatchWithMoney(t.tripId, { ended: false, fee: 300_000, minQuota: 5 });
    await finish(t, done.batchId);
    const draft = await request(t, 400_000);
    await cancel(t, open.batchId);
    // A leftover in the CANCELLED Batch: money its Refund did not take back.
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId: `residue-${open.paymentId}`, legIndex: 0, account: 'TRIP_BALANCE', direction: 'CREDIT', amount: 50_000, volunteerTripId: t.tripId, paymentId: open.paymentId },
        { transactionId: `residue-${open.paymentId}`, legIndex: 1, account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 50_000, volunteerTripId: t.tripId, paymentId: open.paymentId },
      ],
    });
    expect(await balanceOf(t.tripId)).toBe(450_000);
    expect(await withdrawableOf(t.tripId)).toBe(400_000);

    await expect(approve(draft.id)).resolves.toMatchObject({ status: 'APPROVED' });
    expect(await withdrawableOf(t.tripId)).toBe(0);
    await expect(request(t, 1)).rejects.toBeInstanceOf(TripPayoutFundsNotCompletedError);
  });

  it('completes an APPROVED Payout even with an OPEN or CANCELLED Batch of the same Trip holding money', async () => {
    const t = await makeTrip();
    const done = await makeBatchWithMoney(t.tripId, { ended: true, fee: 500_000 });
    await makeBatchWithMoney(t.tripId, { ended: false, fee: 300_000 });
    const cancelled = await makeBatchWithMoney(t.tripId, { ended: false, fee: 200_000, status: 'CANCELLED' });
    await seedPartialRefund(t, cancelled.paymentId, 50_000);
    await finish(t, done.batchId);
    const approved = await approve((await request(t, 500_000)).id);
    // The approved amount is out of TRIP_BALANCE already; what is left is what the other Batches hold.
    expect(await balanceOf(t.tripId)).toBe(450_000);

    await expect(complete(approved.id)).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('completes an APPROVED Payout even when the balance left is below what other Batches hold', async () => {
    const t = await makeTrip();
    const done = await makeBatchWithMoney(t.tripId, { ended: true, fee: 500_000 });
    await makeBatchWithMoney(t.tripId, { ended: false, fee: 300_000 });
    await finish(t, done.batchId);
    const approved = await approve((await request(t, 500_000)).id);
    // Something drew the balance below the 300k the OPEN Batch holds after approval.
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId: `drawn-${approved.id}`, legIndex: 0, account: 'TRIP_BALANCE', direction: 'DEBIT', amount: 100_000, volunteerTripId: t.tripId },
        { transactionId: `drawn-${approved.id}`, legIndex: 1, account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: 100_000 },
      ],
    });
    expect(await balanceOf(t.tripId)).toBe(200_000);

    await expect(complete(approved.id)).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('serialises a Payout request against completeBatch: either order is consistent, and the next request succeeds', async () => {
    for (let round = 0; round < 5; round++) {
      const t = await makeTrip();
      const { batchId } = await makeBatchWithMoney(t.tripId, { ended: true });

      const [payout] = await Promise.allSettled([request(t, 500_000), finish(t, batchId)]);

      expect((await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe('COMPLETED');
      if (payout.status === 'rejected') {
        // The request took the lock before completion: the only valid refusal.
        expect(payout.reason).toBeInstanceOf(TripPayoutFundsNotCompletedError);
        expect(await prisma.payout.count({ where: { volunteerTripId: t.tripId } })).toBe(0);
        await expect(request(t, 500_000)).resolves.toMatchObject({ status: 'DRAFT' });
      } else {
        expect(await prisma.payout.count({ where: { volunteerTripId: t.tripId } })).toBe(1);
      }
    }
  });

  it('approves exactly one of two Payouts that together exceed the COMPLETED Batch money, approved at once', async () => {
    const t = await makeTrip();
    const { batchId } = await makeBatchWithMoney(t.tripId, { ended: true, fee: 500_000 });
    await makeBatchWithMoney(t.tripId, { ended: false, fee: 500_000 });
    await finish(t, batchId);
    const a = await request(t, 300_000);
    const b = await request(t, 300_000);
    const admin = await makeUser();

    const results = await Promise.allSettled(
      [a, b].map((p) => approvePayout(prisma, { payoutId: p.id, approvedById: admin, provider: 'sumopod', providerBalance: 5_000_000 })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect(lost.reason).toBeInstanceOf(TripPayoutFundsNotCompletedError);
    expect(await prisma.payout.count({ where: { volunteerTripId: t.tripId, status: 'APPROVED' } })).toBe(1);
  });
});
