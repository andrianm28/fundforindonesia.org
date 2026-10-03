// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Ticket 43: the sweep for Trip Fee Refunds stuck after a late settlement,
 * against a REAL Postgres. The idempotency guard under test is a row lock
 * (Trip -> Registration -> Payment) plus createRefund's remaining-amount
 * check, so a JS mock would only prove the mock. Same setup as
 * escrow-sweep-rotation.test.ts: a throwaway database migrated by replaying
 * every migration, `@/lib/prisma` mocked to a real client, and a visible skip
 * (not a green pass) when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!DATABASE_URL)('sweepStuckLateSettlementRefunds -- against real Postgres (ticket 43)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[stuck refund sweep] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `stuck_refund_sweep_${process.pid}`;
  let prisma: PrismaClient;
  let sweep: typeof import('@/lib/volunteer/refund-sweep').sweepStuckLateSettlementRefunds;
  let postTransaction: typeof import('@/lib/money/ledger').postTransaction;
  let paymentSettledLegs: typeof import('@/lib/money/ledger').paymentSettledLegs;

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
    ({ sweepStuckLateSettlementRefunds: sweep } = await import('@/lib/volunteer/refund-sweep'));
    ({ postTransaction, paymentSettledLegs } = await import('@/lib/money/ledger'));
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

  /** A fresh Trip + Batch departing `departsInDays` from now. */
  async function makeBatch(departsInDays = 30): Promise<{ tripId: string; batchId: string }> {
    const fundraiserId = await makeUser();
    const n = next();
    const trip = await prisma.volunteerTrip.create({
      data: {
        slug: `trip-${process.pid}-${n}`,
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
    const batch = await prisma.volunteerBatch.create({
      data: {
        tripId: trip.id,
        startDate: new Date(Date.now() + departsInDays * MS_PER_DAY),
        endDate: new Date(Date.now() + (departsInDays + 3) * MS_PER_DAY),
        registrationDeadline: new Date(Date.now() + (departsInDays - 5) * MS_PER_DAY),
        maxQuota: 50,
        minQuota: 1,
      },
    });
    return { tripId: trip.id, batchId: batch.id };
  }

  /**
   * A Registration in `status` with a PAID Trip Fee Payment and its
   * settlement ledger legs. `settled` says which came first, in real
   * database time: 'after' = the late-settlement shape (status change, then
   * settlement), 'before' = the Registration was CONFIRMED and paid, then
   * left the live statuses (Volunteer cancel).
   */
  async function makeRegistration(
    ctx: { tripId: string; batchId: string },
    status: 'CANCELLED' | 'EXPIRED' | 'CONFIRMED',
    opts: { settled?: 'after' | 'before'; changedAt?: Date } = {},
  ): Promise<{ registrationId: string; paymentId: string }> {
    const { settled = 'after', changedAt = new Date(Date.now() - 2 * 60 * 60 * 1000) } = opts;
    const n = next();
    const volunteerId = await makeUser();
    const registration = await prisma.registration.create({
      data: {
        volunteerId,
        batchId: ctx.batchId,
        status,
        holdExpiresAt: new Date(changedAt.getTime() - 30 * 60 * 1000),
        updatedAt: changedAt,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${n}`,
        amount: 500_000,
        status: 'PAID',
        paidAt: new Date(),
        settledAt: new Date(),
      },
    });
    await prisma.$transaction(async (tx) => {
      await postTransaction(
        tx,
        paymentSettledLegs({ subject: { type: 'trip', tripId: ctx.tripId }, grossAmount: 500_000, providerFee: 0 }),
        { paymentId: payment.id, transactionId: `settle-${payment.id}` },
      );
    });
    // Pin the settlement's database time relative to the status change.
    await prisma.ledgerEntry.updateMany({
      where: { paymentId: payment.id },
      data: {
        createdAt:
          settled === 'after'
            ? new Date(changedAt.getTime() + 60 * 60 * 1000)
            : new Date(changedAt.getTime() - 60 * 60 * 1000),
      },
    });
    return { registrationId: registration.id, paymentId: payment.id };
  }

  const refundsOf = (paymentId: string) => prisma.refund.findMany({ where: { paymentId } });

  it('refunds EXPIRED and CANCELLED late settlements in full, once each, and touches nothing else', async () => {
    const ctx = await makeBatch();
    const expired = await makeRegistration(ctx, 'EXPIRED');
    const cancelled = await makeRegistration(ctx, 'CANCELLED');
    const confirmed = await makeRegistration(ctx, 'CONFIRMED', { settled: 'before' });
    // Volunteer cancelled a paid Registration inside the no-refund window:
    // no Refund exists by policy, and the sweep must not invent one.
    const noRefundCancel = await makeRegistration(await makeBatch(1), 'CANCELLED', { settled: 'before' });
    // Cancelled with a Refund already (half, any status): never created again.
    const alreadyRefunded = await makeRegistration(ctx, 'CANCELLED', { settled: 'before' });
    await prisma.refund.create({
      data: {
        paymentId: alreadyRefunded.paymentId,
        amount: 250_000,
        reason: 'Volunteer membatalkan Registrasi',
        status: 'REJECTED',
        requestedById: (await prisma.registration.findUniqueOrThrow({ where: { id: alreadyRefunded.registrationId } }))
          .volunteerId,
      },
    });

    const result = await sweep(new Date());

    expect(result).toMatchObject({ attemptedCount: 2, refundedCount: 2, failedCount: 0 });
    for (const stuck of [expired, cancelled]) {
      const refunds = await refundsOf(stuck.paymentId);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({ amount: 500_000, status: 'REQUESTED' });
    }
    expect(await refundsOf(confirmed.paymentId)).toHaveLength(0);
    expect(await refundsOf(noRefundCancel.paymentId)).toHaveLength(0);
    expect(await refundsOf(alreadyRefunded.paymentId)).toHaveLength(1);
  }, 60_000);

  it('run twice in a row leaves one Refund', async () => {
    const stuck = await makeRegistration(await makeBatch(), 'EXPIRED');
    const first = await sweep(new Date(), { limit: 1000 });
    const second = await sweep(new Date(), { limit: 1000 });
    expect(first.refundedCount).toBeGreaterThanOrEqual(1);
    expect(second).toMatchObject({ attemptedCount: 0, refundedCount: 0, failedCount: 0 });
    expect(await refundsOf(stuck.paymentId)).toHaveLength(1);
  }, 60_000);

  it('is bounded per round, oldest first', async () => {
    const ctx = await makeBatch();
    const base = Date.now() - 10 * MS_PER_DAY;
    const oldest = await makeRegistration(ctx, 'EXPIRED', { changedAt: new Date(base) });
    const middle = await makeRegistration(ctx, 'EXPIRED', { changedAt: new Date(base + 1000) });
    const newest = await makeRegistration(ctx, 'EXPIRED', { changedAt: new Date(base + 2000) });

    // Older rows from earlier tests in this database are already swept, so
    // exactly these three are eligible.
    const result = await sweep(new Date(), { limit: 2 });
    expect(result.attemptedCount).toBe(2);
    expect(await refundsOf(oldest.paymentId)).toHaveLength(1);
    expect(await refundsOf(middle.paymentId)).toHaveLength(1);
    expect(await refundsOf(newest.paymentId)).toHaveLength(0);

    const rest = await sweep(new Date(), { limit: 2 });
    expect(rest.attemptedCount).toBe(1);
    expect(await refundsOf(newest.paymentId)).toHaveLength(1);
  }, 60_000);

  it('one failing Registration does not stop the rest, is logged by id only, and rotates behind the others', async () => {
    const ctx = await makeBatch();
    const base = Date.now() - 20 * MS_PER_DAY;
    const bad = await makeRegistration(ctx, 'EXPIRED', { changedAt: new Date(base) });
    const good = await makeRegistration(ctx, 'EXPIRED', { changedAt: new Date(base + 1000) });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { refundLateSettlement } = await import('@/lib/volunteer/trip');

    const result = await sweep(new Date(), {
      refund: async (client, params) => {
        if (params.registrationId === bad.registrationId) throw new Error('boom');
        return refundLateSettlement(client, params);
      },
    });

    expect(result).toMatchObject({ attemptedCount: 2, refundedCount: 1, failedCount: 1 });
    expect(await refundsOf(good.paymentId)).toHaveLength(1);
    expect(await refundsOf(bad.paymentId)).toHaveLength(0);
    const logged = JSON.stringify(errorSpy.mock.calls.map((c) => c.map(String)));
    expect(logged).toContain(bad.registrationId);
    expect(logged).not.toContain('@');
    errorSpy.mockRestore();

    // The failed one now sorts behind a never-failed row, so a backlog of
    // permanent failures cannot starve fresh rows under the limit.
    const fresh = await makeRegistration(ctx, 'EXPIRED', { changedAt: new Date(base + 2000) });
    const round = await sweep(new Date(), { limit: 1 });
    expect(round.refundedCount).toBe(1);
    expect(await refundsOf(fresh.paymentId)).toHaveLength(1);
    expect(await refundsOf(bad.paymentId)).toHaveLength(0);
  }, 60_000);

  it('two concurrent sweeps create exactly one Refund per Registration', async () => {
    // Drain leftovers of earlier tests (the one that injected a failure) so
    // exactly these six are eligible.
    await sweep(new Date(), { limit: 1000 });
    const ctx = await makeBatch();
    const stuck: Array<{ registrationId: string; paymentId: string }> = [];
    for (let i = 0; i < 6; i++) stuck.push(await makeRegistration(ctx, i % 2 ? 'CANCELLED' : 'EXPIRED'));

    const [a, b] = await Promise.all([
      sweep(new Date(), { limit: 100 }),
      sweep(new Date(), { limit: 100 }),
    ]);

    for (const s of stuck) {
      const refunds = await refundsOf(s.paymentId);
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amount).toBe(500_000);
    }
    // Each Registration was refunded by exactly one of the two sweeps; the
    // loser of each race found it already refunded -- not a failure.
    expect(a.refundedCount + b.refundedCount).toBe(6);
    expect(a.failedCount + b.failedCount).toBe(0);
    // One ledger freeze per Refund: no double movement out of the pool.
    const refundIds = (await prisma.refund.findMany({ where: { paymentId: { in: stuck.map((s) => s.paymentId) } } })).map(
      (r) => r.id,
    );
    expect(await prisma.ledgerEntry.count({ where: { refundId: { in: refundIds }, legIndex: 0 } })).toBe(6);
  }, 60_000);

  /** A Registration with a Payment and a real clock: nothing is back-dated. */
  async function makeLive(ctx: { tripId: string; batchId: string }, status: 'HOLD' | 'CONFIRMED') {
    const n = next();
    const volunteerId = await makeUser();
    const registration = await prisma.registration.create({
      data: { volunteerId, batchId: ctx.batchId, status, holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
    const payment = await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `live-${process.pid}-${n}`,
        amount: 500_000,
        status: status === 'CONFIRMED' ? 'PAID' : 'PENDING',
      },
    });
    return { registrationId: registration.id, paymentId: payment.id, volunteerId };
  }

  async function settle(ctx: { tripId: string }, paymentId: string) {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: 'PAID', paidAt: new Date(), settledAt: new Date() } });
    await prisma.$transaction(async (tx) => {
      await postTransaction(
        tx,
        paymentSettledLegs({ subject: { type: 'trip', tripId: ctx.tripId }, grossAmount: 500_000, providerFee: 0 }),
        { paymentId, transactionId: `settle-${paymentId}` },
      );
    });
  }

  it('real cancelRegistration inside 3 days: a paid Volunteer cancel with no refund is NOT swept; a cancelled HOLD that settles late IS', async () => {
    await sweep(new Date(), { limit: 1000 });
    const { cancelRegistration } = await import('@/lib/volunteer/trip');
    const ctx = await makeBatch(1);

    // Paid first, then the Volunteer cancels: tier owes 0, so no Refund by policy.
    const paid = await makeLive(ctx, 'CONFIRMED');
    await settle(ctx, paid.paymentId);
    const cancelledPaid = await cancelRegistration(prisma, {
      registrationId: paid.registrationId,
      actor: { userId: paid.volunteerId },
    });
    expect(cancelledPaid.refund).toBeNull();

    // Cancelled while still HOLD, then the Trip Fee settles late.
    const held = await makeLive(ctx, 'HOLD');
    await cancelRegistration(prisma, { registrationId: held.registrationId, actor: { userId: held.volunteerId } });
    await settle(ctx, held.paymentId);

    const result = await sweep(new Date(), { limit: 1000 });

    expect(result).toMatchObject({ attemptedCount: 1, refundedCount: 1, failedCount: 0 });
    expect(await refundsOf(paid.paymentId)).toHaveLength(0);
    const refunds = await refundsOf(held.paymentId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(500_000);
  }, 60_000);

  it('two overlapping refundLateSettlement calls on one Registration create exactly one Refund', async () => {
    const { refundLateSettlement } = await import('@/lib/volunteer/trip');
    const stuck = await makeRegistration(await makeBatch(), 'EXPIRED');

    const outcomes = await Promise.allSettled([
      refundLateSettlement(prisma, { registrationId: stuck.registrationId }),
      refundLateSettlement(prisma, { registrationId: stuck.registrationId }),
    ]);

    expect(await refundsOf(stuck.paymentId)).toHaveLength(1);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const o of outcomes) {
      if (o.status === 'rejected') expect(o.reason?.constructor?.name).toBe('RefundExceedsRemainingError');
    }
  }, 60_000);
});
