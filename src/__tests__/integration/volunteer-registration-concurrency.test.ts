// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  BatchFullError,
  AlreadyRegisteredError,
  BatchLockedByRegistrationsError,
  BatchNotOpenError,
  BatchQuotaBelowSeatsError,
  OwnTripRegistrationError,
  RegistrationNotCancellableError,
} from '@/lib/volunteer-trip-errors';

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
  let editBatch: typeof import('@/lib/volunteer/trip').editBatch;
  let cancelBatch: typeof import('@/lib/volunteer/trip').cancelBatch;
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
    ({ holdRegistration, cancelRegistration, editBatch, cancelBatch, completeBatch, confirmRegistration, refundLateSettlement } = await import('@/lib/volunteer/trip'));
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

  // Deterministic: completeBatch is paused right after it has locked the
  // Registrations (the lock order that matters), a settlement is started and
  // proven to be waiting on that row lock, and only then is completeBatch let
  // go. The settlement's CAS must re-evaluate after the commit and find EXPIRED.
  it('settles to lapsed, with a full Refund and no CONFIRMED seat, when it waits on completeBatch\'s Registration lock', async () => {
    const h = await heldWithPendingPayment();
    let reached!: () => void;
    let release!: () => void;
    const lockHeld = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let paused = false;

    const pausing = {
      $transaction: <T,>(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) =>
        prisma.$transaction((tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop) {
                const value = Reflect.get(target, prop, target);
                if (prop !== '$queryRaw' || typeof value !== 'function') return value;
                return async (strings: TemplateStringsArray, ...rest: unknown[]) => {
                  const rows = await value.call(target, strings, ...rest);
                  if (!paused && strings.join('?').includes('FROM "Registration"')) {
                    paused = true;
                    reached();
                    await gate;
                  }
                  return rows;
                };
              },
            }),
          ),
        ),
    };

    const completing = completeBatch(pausing as never, { tripId: h.tripId, batchId: h.batchId, actor: h.actor as never, attendedRegistrationIds: [] });
    await lockHeld;
    const settling = settle(h.registrationId, h.paymentId);

    // Wait until the settlement is provably blocked on a row lock.
    for (let i = 0; i < 100; i++) {
      const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (n > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    release();
    await completing;
    const settled = await settling;

    expect(settled.outcome).toBe('lapsed');
    await refundLateSettlement(prisma, { registrationId: h.registrationId });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: h.registrationId } })).status).toBe('EXPIRED');
    expect(await prisma.registration.count({ where: { batchId: h.batchId, status: 'CONFIRMED' } })).toBe(0);
    const refunds = await prisma.refund.findMany({ where: { paymentId: h.paymentId } });
    expect(refunds.map((r) => r.amount)).toEqual([500_000]);
  });

  // Ticket 48: the edit judges "does the Batch have a live Registration" under
  // the Trip -> Batch -> Registrations locks that holdRegistration takes, so an
  // edit and a hold racing never leave a Registration on a Batch whose
  // startDate moved after it was taken.
  it('serialises a date edit against a hold: either the edit wins and the hold sees the new date, or the hold wins and the edit is refused', async () => {
    for (let round = 0; round < 8; round++) {
      const { tripId, batchId, fundraiserId } = await makeBatch({ maxQuota: 5, departsInDays: 30 });
      const volunteerId = await makeUser();
      const before = await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
      const newStart = new Date(before.startDate.getTime() + 2 * MS_PER_DAY);
      const newEnd = new Date(before.endDate.getTime() + 2 * MS_PER_DAY);

      const [edit, hold] = await Promise.allSettled([
        editBatch(prisma, {
          tripId,
          batchId,
          actor: { userId: fundraiserId, assignments: [] },
          edits: { startDate: newStart, endDate: newEnd },
        }),
        holdRegistration(prisma, { tripId, batchId, volunteerId }),
      ]);

      const after = await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(hold.status).toBe('fulfilled');
      if (edit.status === 'fulfilled') {
        expect(after.startDate).toEqual(newStart);
      } else {
        expect(edit.reason).toBeInstanceOf(BatchLockedByRegistrationsError);
        expect(after.startDate).toEqual(before.startDate);
      }
    }
  });

  // The loop above only shows the orders the scheduler happens to pick. This
  // one FORCES the interleaving that breaks an edit without its locks: a
  // statement-level trigger makes the edit's own UPDATE of the Batch sleep,
  // which is after it counted the seats (none) and before it writes. A hold
  // started inside that gap commits first when the edit holds no lock; with
  // the Trip -> Batch -> Registrations locks the hold waits for the edit.
  it('forces a hold into the gap between an edit\'s seat count and its write: the hold must wait and see the new date', async () => {
    const GAP_MS = 900;
    const dba = new Client({ connectionString: databaseUrlFor(databaseName) });
    await dba.connect();
    await dba.query(`
      CREATE FUNCTION ffi_test_edit_gap() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(${GAP_MS / 1000}); RETURN NULL; END $$;
      CREATE TRIGGER ffi_test_edit_gap BEFORE UPDATE ON "VolunteerBatch"
        FOR EACH STATEMENT EXECUTE FUNCTION ffi_test_edit_gap();
    `);
    try {
      const { tripId, batchId, fundraiserId } = await makeBatch({ maxQuota: 5, departsInDays: 30 });
      const volunteerId = await makeUser();
      const before = await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
      const newStart = new Date(before.startDate.getTime() + 2 * MS_PER_DAY);
      const newEnd = new Date(before.endDate.getTime() + 2 * MS_PER_DAY);

      const edit = editBatch(prisma, {
        tripId,
        batchId,
        actor: { userId: fundraiserId, assignments: [] },
        edits: { startDate: newStart, endDate: newEnd },
      }).then((r) => ({ r, at: Date.now() }));
      await new Promise((resolve) => setTimeout(resolve, GAP_MS / 3));
      const hold = holdRegistration(prisma, { tripId, batchId, volunteerId }).then((r) => ({ r, at: Date.now() }));

      const [editDone, holdDone] = await Promise.all([edit, hold]);

      // Invariant: a live Registration never sits on a Batch whose dates
      // moved after it was taken, i.e. if the dates moved, the hold finished
      // after the edit did and so saw them.
      const after = await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(await prisma.registration.count({ where: { batchId, status: { in: ['HOLD', 'CONFIRMED'] } } })).toBe(1);
      expect(after.startDate).toEqual(newStart);
      expect(holdDone.at).toBeGreaterThanOrEqual(editDone.at);
    } finally {
      await dba.query('DROP TRIGGER ffi_test_edit_gap ON "VolunteerBatch"; DROP FUNCTION ffi_test_edit_gap();');
      await dba.end();
    }
  }, 30_000);

  // Ticket 48 review: an edit racing the other writers that take the same
  // locks. Each must settle (no deadlock: the vitest timeout is the detector)
  // and leave a state no interleaving could produce wrongly.
  async function batchWithRegistration(opts: { departsInDays: number; status: 'HOLD' | 'CONFIRMED'; minQuota: number }) {
    const made = await makeBatch({ maxQuota: 5, departsInDays: opts.departsInDays });
    await prisma.volunteerBatch.update({ where: { id: made.batchId }, data: { minQuota: opts.minQuota } });
    const volunteerId = await makeUser();
    const registration = await prisma.registration.create({
      data: {
        volunteerId,
        batchId: made.batchId,
        status: opts.status,
        holdExpiresAt: new Date(Date.now() + (opts.status === 'HOLD' ? 30 * 60 * 1000 : -60 * 60 * 1000)),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: 500_000,
        status: opts.status === 'CONFIRMED' ? 'PAID' : 'PENDING',
        ...(opts.status === 'CONFIRMED' ? { paidAt: new Date(), settledAt: new Date() } : {}),
      },
    });
    return { ...made, registrationId: registration.id, paymentId: payment.id };
  }

  it('settles an edit racing a settlement (confirmRegistration): the seat is confirmed, dates stay locked, the quota edit lands', async () => {
    for (let round = 0; round < 6; round++) {
      const { tripId, batchId, fundraiserId, registrationId } = await batchWithRegistration({
        departsInDays: 30,
        status: 'HOLD',
        minQuota: 1,
      });
      const before = await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
      const actor = { userId: fundraiserId, assignments: [] };

      const [edit, confirm, dateEdit] = await Promise.allSettled([
        editBatch(prisma, { tripId, batchId, actor, edits: { maxQuota: 2 } }),
        prisma.$transaction((tx) => confirmRegistration(tx, { registrationId })),
        editBatch(prisma, {
          tripId,
          batchId,
          actor,
          edits: { startDate: new Date(before.startDate.getTime() + MS_PER_DAY) },
        }),
      ]);

      expect(confirm).toMatchObject({ status: 'fulfilled', value: { outcome: 'confirmed' } });
      expect(edit.status).toBe('fulfilled');
      // HOLD or CONFIRMED, the seat is live either way: the dates stay locked.
      expect(dateEdit.status).toBe('rejected');
      expect((dateEdit as PromiseRejectedResult).reason).toBeInstanceOf(BatchLockedByRegistrationsError);
      const after = await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(after).toMatchObject({ maxQuota: 2, minQuota: 1, startDate: before.startDate, status: 'OPEN' });
      expect((await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } })).status).toBe('CONFIRMED');
    }
  }, 30_000);

  it('refuses a minQuota raise above the CONFIRMED count whichever way it races a settlement', async () => {
    for (let round = 0; round < 4; round++) {
      const { tripId, batchId, fundraiserId, registrationId } = await batchWithRegistration({
        departsInDays: 30,
        status: 'HOLD',
        minQuota: 1,
      });
      const [edit, confirm] = await Promise.allSettled([
        editBatch(prisma, { tripId, batchId, actor: { userId: fundraiserId, assignments: [] }, edits: { minQuota: 2 } }),
        prisma.$transaction((tx) => confirmRegistration(tx, { registrationId })),
      ]);
      expect(confirm.status).toBe('fulfilled');
      expect(edit.status).toBe('rejected');
      expect((edit as PromiseRejectedResult).reason).toBeInstanceOf(BatchQuotaBelowSeatsError);
      expect((await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } })).minQuota).toBe(1);
    }
  }, 30_000);

  it('settles an edit racing cancelBatch: the Batch ends CANCELLED with one Refund, and the edit landed first or was refused as not OPEN', async () => {
    for (let round = 0; round < 6; round++) {
      const { tripId, batchId, fundraiserId, registrationId, paymentId } = await batchWithRegistration({
        departsInDays: 30,
        status: 'CONFIRMED',
        minQuota: 2,
      });
      const actor = { userId: fundraiserId, assignments: [] };

      const [edit, cancel] = await Promise.allSettled([
        editBatch(prisma, { tripId, batchId, actor, edits: { maxQuota: 4 } }),
        cancelBatch(prisma, { tripId, batchId, actor }),
      ]);

      expect(cancel.status).toBe('fulfilled');
      const after = await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(after.status).toBe('CANCELLED');
      if (edit.status === 'fulfilled') {
        expect(after.maxQuota).toBe(4);
      } else {
        expect(edit.reason).toBeInstanceOf(BatchNotOpenError);
        expect(after.maxQuota).toBe(5);
      }
      expect((await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } })).status).toBe('CANCELLED');
      expect(await prisma.refund.count({ where: { paymentId } })).toBe(1);
    }
  }, 30_000);

  it('settles an edit racing completeBatch: the Batch ends COMPLETED with attendance recorded, and the edit landed first or was refused as not OPEN', async () => {
    for (let round = 0; round < 6; round++) {
      // Ended a week ago, so it may be completed.
      const { tripId, batchId, fundraiserId, registrationId } = await batchWithRegistration({
        departsInDays: -10,
        status: 'CONFIRMED',
        minQuota: 1,
      });
      const actor = { userId: fundraiserId, assignments: [] };

      const [edit, complete] = await Promise.allSettled([
        editBatch(prisma, { tripId, batchId, actor, edits: { maxQuota: 4 } }),
        completeBatch(prisma, { tripId, batchId, actor, attendedRegistrationIds: [registrationId] }),
      ]);

      expect(complete.status).toBe('fulfilled');
      const after = await prisma.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(after.status).toBe('COMPLETED');
      if (edit.status === 'fulfilled') {
        expect(after.maxQuota).toBe(4);
      } else {
        expect(edit.reason).toBeInstanceOf(BatchNotOpenError);
        expect(after.maxQuota).toBe(5);
      }
      expect((await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } })).attended).toBe(true);
    }
  }, 30_000);

  it('refuses a date edit once a Volunteer holds a seat, and a past date on an empty Batch', async () => {
    const { tripId, batchId, fundraiserId } = await makeBatch({ maxQuota: 5, departsInDays: 30 });
    const actor = { userId: fundraiserId, assignments: [] };
    const past = new Date(Date.now() - MS_PER_DAY);
    await expect(editBatch(prisma, { tripId, batchId, actor, edits: { startDate: past, registrationDeadline: past } })).rejects.toThrow(
      /startDate harus di masa depan/,
    );
    // The message names the field that is wrong, not always startDate.
    const later = new Date(Date.now() + 90 * MS_PER_DAY);
    await expect(editBatch(prisma, { tripId, batchId, actor, edits: { startDate: later, endDate: past } })).rejects.toThrow(
      /endDate harus di masa depan/,
    );
    await expect(editBatch(prisma, { tripId, batchId, actor, edits: { registrationDeadline: past } })).rejects.toThrow(
      /registrationDeadline harus di masa depan/,
    );
    await holdRegistration(prisma, { tripId, batchId, volunteerId: await makeUser() });
    const locked = await editBatch(prisma, {
      tripId,
      batchId,
      actor,
      edits: { startDate: new Date(Date.now() + MS_PER_DAY), endDate: new Date(Date.now() + 5 * MS_PER_DAY) },
    }).catch((e: unknown) => e);
    expect(locked).toBeInstanceOf(BatchLockedByRegistrationsError);
    expect((locked as BatchLockedByRegistrationsError).message).toContain('startDate, endDate');
  });

  it('refuses the Trip\'s own Fundraiser as a Volunteer', async () => {
    const { tripId, batchId, fundraiserId } = await makeBatch({ maxQuota: 5, departsInDays: 30 });
    await expect(holdRegistration(prisma, { tripId, batchId, volunteerId: fundraiserId })).rejects.toBeInstanceOf(
      OwnTripRegistrationError,
    );
    expect(await prisma.registration.count({ where: { batchId } })).toBe(0);
  });
});
