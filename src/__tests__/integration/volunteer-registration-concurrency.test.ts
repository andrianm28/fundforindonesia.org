// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { BatchFullError, AlreadyRegisteredError, RegistrationNotCancellableError } from '@/lib/volunteer-trip-errors';

/**
 * Ticket 36: the Registration flow's two concurrency guarantees, against a
 * REAL Postgres, because both are row locks (Trip -> Batch, Trip ->
 * Registration -> Payment) that a JS mock would only mirror:
 *   - two Volunteers racing for the last seat: exactly one holds it;
 *   - a Volunteer cancelling the same paid Registration twice at once (double
 *     click, two tabs): exactly one cancel and exactly one Refund.
 * Same setup as stuck-refund-sweep.test.ts: a throwaway database migrated by
 * replaying every migration, and a visible skip (not a green pass) when
 * TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Volunteer Registration concurrency -- against real Postgres (ticket 36)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[volunteer registration concurrency] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `volunteer_registration_${process.pid}`;
  let prisma: PrismaClient;
  let holdRegistration: typeof import('@/lib/volunteer/trip').holdRegistration;
  let cancelRegistration: typeof import('@/lib/volunteer/trip').cancelRegistration;
  let completeBatch: typeof import('@/lib/volunteer/trip').completeBatch;
  let confirmRegistration: typeof import('@/lib/volunteer/trip').confirmRegistration;
  let refundLateSettlement: typeof import('@/lib/volunteer/trip').refundLateSettlement;

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
    ({ holdRegistration, cancelRegistration, completeBatch, confirmRegistration, refundLateSettlement } = await import('@/lib/volunteer/trip'));
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

  async function makeBatch(opts: { maxQuota: number; departsInDays: number }) {
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
        tripFeeAmount: 500_000,
        status: 'ACTIVE',
        fundraiserId,
      },
    });
    const batch = await prisma.volunteerBatch.create({
      data: {
        tripId: trip.id,
        startDate: new Date(Date.now() + opts.departsInDays * MS_PER_DAY),
        endDate: new Date(Date.now() + (opts.departsInDays + 3) * MS_PER_DAY),
        registrationDeadline: new Date(Date.now() + (opts.departsInDays - 5) * MS_PER_DAY),
        maxQuota: opts.maxQuota,
        minQuota: 1,
      },
    });
    return { tripId: trip.id, batchId: batch.id, fundraiserId };
  }

  it('lets exactly one of several Volunteers racing for the last seat hold it', async () => {
    const { tripId, batchId } = await makeBatch({ maxQuota: 1, departsInDays: 30 });
    const volunteers = await Promise.all(Array.from({ length: 6 }, () => makeUser()));

    const results = await Promise.allSettled(
      volunteers.map((volunteerId) => holdRegistration(prisma, { tripId, batchId, volunteerId })),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(5);
    for (const r of lost) expect(r.reason).toBeInstanceOf(BatchFullError);
    expect(await prisma.registration.count({ where: { batchId, status: 'HOLD' } })).toBe(1);
  });

  it('never oversells a Batch of several seats under a burst of holds', async () => {
    const { tripId, batchId } = await makeBatch({ maxQuota: 3, departsInDays: 30 });
    const volunteers = await Promise.all(Array.from({ length: 10 }, () => makeUser()));

    await Promise.allSettled(volunteers.map((volunteerId) => holdRegistration(prisma, { tripId, batchId, volunteerId })));

    expect(await prisma.registration.count({ where: { batchId, status: { in: ['HOLD', 'CONFIRMED'] } } })).toBe(3);
  });

  it('gives one Volunteer a single hold when they double-submit at once', async () => {
    const { tripId, batchId } = await makeBatch({ maxQuota: 5, departsInDays: 30 });
    const volunteerId = await makeUser();

    const results = await Promise.allSettled([
      holdRegistration(prisma, { tripId, batchId, volunteerId }),
      holdRegistration(prisma, { tripId, batchId, volunteerId }),
      holdRegistration(prisma, { tripId, batchId, volunteerId }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(AlreadyRegisteredError);
    }
    expect(await prisma.registration.count({ where: { batchId, volunteerId } })).toBe(1);
  });

  it('frees the seat of a cancelled hold for the next Volunteer', async () => {
    const { tripId, batchId } = await makeBatch({ maxQuota: 1, departsInDays: 30 });
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { registration } = await holdRegistration(prisma, { tripId, batchId, volunteerId: a });
    await expect(holdRegistration(prisma, { tripId, batchId, volunteerId: b })).rejects.toBeInstanceOf(BatchFullError);

    await cancelRegistration(prisma, { registrationId: registration.id, actor: { userId: a } });

    await expect(holdRegistration(prisma, { tripId, batchId, volunteerId: b })).resolves.toBeTruthy();
  });

  async function paidRegistration(departsInDays: number) {
    const { tripId, batchId } = await makeBatch({ maxQuota: 5, departsInDays });
    const volunteerId = await makeUser();
    const registration = await prisma.registration.create({
      data: { volunteerId, batchId, status: 'CONFIRMED', holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const payment = await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: 500_000,
        status: 'PAID',
        paidAt: new Date(),
        settledAt: new Date(),
      },
    });
    return { tripId, volunteerId, registrationId: registration.id, paymentId: payment.id };
  }

  it('writes exactly one Refund when the Volunteer cancels a paid Registration twice at once', async () => {
    const { volunteerId, registrationId, paymentId } = await paidRegistration(30);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => cancelRegistration(prisma, { registrationId, actor: { userId: volunteerId } })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(RegistrationNotCancellableError);
    }
    const refunds = await prisma.refund.findMany({ where: { paymentId } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: 500_000, status: 'REQUESTED', requestedById: volunteerId });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } })).status).toBe('CANCELLED');
  });

  it('refunds half 5 days out, and writes no Refund inside the no-refund window', async () => {
    const half = await paidRegistration(5);
    await cancelRegistration(prisma, { registrationId: half.registrationId, actor: { userId: half.volunteerId } });
    expect((await prisma.refund.findMany({ where: { paymentId: half.paymentId } })).map((r) => r.amount)).toEqual([250_000]);

    const none = await paidRegistration(2);
    await cancelRegistration(prisma, { registrationId: none.registrationId, actor: { userId: none.volunteerId } });
    expect(await prisma.refund.count({ where: { paymentId: none.paymentId } })).toBe(0);
  });

  // Ticket 53: completing a Batch must not leave a HOLD that a late
  // settlement could still confirm.
  async function heldWithPendingPayment() {
    const { tripId, batchId, fundraiserId } = await makeBatch({ maxQuota: 5, departsInDays: -10 });
    const volunteerId = await makeUser();
    const registration = await prisma.registration.create({
      data: { volunteerId, batchId, status: 'HOLD', holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const payment = await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: 500_000,
        status: 'PENDING',
      },
    });
    return { tripId, batchId, volunteerId, registrationId: registration.id, paymentId: payment.id, actor: { userId: fundraiserId, assignments: [] } };
  }

  // The Settlement transaction as the webhook runs it: Payment PAID, then confirmRegistration.
  const settle = (registrationId: string, paymentId: string) =>
    prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'PAID', paidAt: new Date(), settledAt: new Date() } });
      return confirmRegistration(tx as never, { registrationId });
    });

  it('expires a HOLD when its Batch completes; a payment settling afterwards is refunded in full, not confirmed', async () => {
    const h = await heldWithPendingPayment();
    await completeBatch(prisma, { tripId: h.tripId, batchId: h.batchId, actor: h.actor as never, attendedRegistrationIds: [] });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: h.registrationId } })).status).toBe('EXPIRED');

    const { outcome } = await settle(h.registrationId, h.paymentId);
    expect(outcome).toBe('lapsed');
    await refundLateSettlement(prisma, { registrationId: h.registrationId });

    expect((await prisma.registration.findUniqueOrThrow({ where: { id: h.registrationId } })).status).toBe('EXPIRED');
    const refunds = await prisma.refund.findMany({ where: { paymentId: h.paymentId } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: 500_000, requestedById: h.volunteerId });
  });

  it('never leaves a settled Volunteer both without a refund and without a confirmed seat, racing completeBatch', async () => {
    for (let i = 0; i < 5; i++) {
      const h = await heldWithPendingPayment();
      const [, settled] = await Promise.all([
        completeBatch(prisma, { tripId: h.tripId, batchId: h.batchId, actor: h.actor as never, attendedRegistrationIds: [] }),
        settle(h.registrationId, h.paymentId),
      ]);
      if (settled.outcome !== 'confirmed') await refundLateSettlement(prisma, { registrationId: h.registrationId });

      const status = (await prisma.registration.findUniqueOrThrow({ where: { id: h.registrationId } })).status;
      const refunds = await prisma.refund.findMany({ where: { paymentId: h.paymentId } });
      expect(status).not.toBe('HOLD');
      if (status === 'CONFIRMED') expect(refunds).toHaveLength(0);
      else expect(refunds.map((r) => r.amount)).toEqual([500_000]);
    }
  });
});
