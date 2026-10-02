import { describe, it, expect } from 'vitest';
import {
  cancelRegistration,
  confirmRegistration,
  expireRegistrationHold,
  holdRegistration,
  refundLateSettlement,
} from './trip';
import { RefundExceedsRemainingError } from '@/lib/money/errors';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { batchRow, makeTripDb, paymentRow, registrationRow, tripRow } from '../../../tests/support/in-memory-trip-db';

const NOW = new Date('2026-09-26T10:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_WINDOW_MS = 30 * 60 * 1000;

describe('holdRegistration', () => {
  function openTrip(registrations: ReturnType<typeof registrationRow>[] = [], batch = batchRow()) {
    return makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })], batches: [batch], registrations });
  }

  it('holds a seat for the Volunteer, locking the Trip then the Batch, and names the Trip Fee to charge', async () => {
    const db = openTrip();

    const result = await holdRegistration(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      volunteerId: 'volunteer-9',
      now: NOW,
    });

    expect(result.tripFeeAmount).toBe(2_500_000);
    expect(result.registration).toMatchObject({ volunteerId: 'volunteer-9', batchId: 'batch-1', status: 'HOLD' });
    expect(result.registration.holdExpiresAt).toEqual(new Date(NOW.getTime() + HOLD_WINDOW_MS));
    expect(db.registrations).toEqual([expect.objectContaining({ volunteerId: 'volunteer-9', status: 'HOLD' })]);
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1', 'VolunteerBatch:batch-1']);
  });

  it('frees the seats of lapsed holds before counting, so a full Batch with an abandoned hold takes one more', async () => {
    const db = openTrip(
      [
        registrationRow({ id: 'reg-paid', volunteerId: 'volunteer-a', status: 'CONFIRMED' }),
        registrationRow({ id: 'reg-lapsed', volunteerId: 'volunteer-b', status: 'HOLD', holdExpiresAt: NOW }),
      ],
      batchRow({ maxQuota: 2 }),
    );

    await holdRegistration(db.prisma as never, { tripId: 'trip-1', batchId: 'batch-1', volunteerId: 'volunteer-9', now: NOW });

    expect(Object.fromEntries(db.registrations.map((r) => [r.volunteerId, r.status]))).toEqual({
      'volunteer-a': 'CONFIRMED',
      'volunteer-b': 'EXPIRED',
      'volunteer-9': 'HOLD',
    });
  });

  it.each([
    ['a Trip that is not ACTIVE', { trip: 'SUSPENDED' }, 'TRIP_NOT_TAKING_REGISTRATIONS', 400],
    ['a Batch that is not OPEN', { batch: batchRow({ status: 'CLOSED' }) }, 'BATCH_NOT_TAKING_REGISTRATIONS', 400],
    [
      'a Batch whose registrationDeadline has passed',
      { batch: batchRow({ registrationDeadline: NOW }) },
      'REGISTRATION_DEADLINE_PASSED',
      400,
    ],
    ['a Batch of another Trip', { batch: batchRow({ tripId: 'trip-2' }) }, 'BATCH_NOT_FOUND', 404],
    [
      'a full Batch',
      { batch: batchRow({ maxQuota: 1 }), registrations: [registrationRow({ volunteerId: 'volunteer-a', status: 'HOLD' })] },
      'BATCH_FULL',
      400,
    ],
    [
      'a Volunteer who already holds a seat on it',
      { registrations: [registrationRow({ volunteerId: 'volunteer-9', status: 'HOLD' })] },
      'ALREADY_REGISTERED',
      400,
    ],
  ] as const)('refuses %s, holding nothing', async (_label, setup, code, status) => {
    const setupFields = setup as { trip?: 'SUSPENDED'; batch?: ReturnType<typeof batchRow>; registrations?: ReturnType<typeof registrationRow>[] };
    const db = makeTripDb({
      trips: [tripRow({ status: setupFields.trip ?? 'ACTIVE' }), tripRow({ id: 'trip-2', slug: 'lain', status: 'ACTIVE' })],
      batches: [setupFields.batch ?? batchRow()],
      registrations: setupFields.registrations ?? [],
    });
    const before = db.registrations.length;

    const error = await holdRegistration(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      volunteerId: 'volunteer-9',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(domainErrorToHttp(error)).toMatchObject({ status, body: { code } });
    expect(db.registrations).toHaveLength(before);
  });

  it('judges the Batch before the Trip, as the hold route always answered', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'SUSPENDED' })], batches: [batchRow({ tripId: 'trip-2' })] });

    const error = await holdRegistration(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      volunteerId: 'volunteer-9',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(domainErrorToHttp(error)).toMatchObject({ status: 404, body: { code: 'BATCH_NOT_FOUND' } });
  });

  it('refuses the last seat to a hold that waited on the lock while another hold took it', async () => {
    const db = openTrip([], batchRow({ maxQuota: 1 }));
    db.beforeNextRowLock((data) => {
      data.registrations.push(registrationRow({ id: 'reg-first', volunteerId: 'volunteer-a', status: 'HOLD' }));
    });

    const error = await holdRegistration(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      volunteerId: 'volunteer-b',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(domainErrorToHttp(error)).toMatchObject({ status: 400, body: { code: 'BATCH_FULL' } });
    expect(db.registrations.map((r) => r.volunteerId)).toEqual(['volunteer-a']);
  });
});

describe('cancelRegistration', () => {
  const volunteer = { userId: 'volunteer-1' };

  /** One paid Registration on a Batch departing `departureInDays` from NOW. */
  function paidRegistration(departureInDays = 30, registration = registrationRow()) {
    return makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batchRow({ startDate: new Date(NOW.getTime() + departureInDays * DAY_MS) })],
      registrations: [registration],
      payments: [paymentRow({ amount: 100_000 })],
    });
  }

  it('cancels a CONFIRMED Registration far from departure with a full Refund requested by the Volunteer', async () => {
    const db = paidRegistration(30);

    const result = await cancelRegistration(db.prisma as never, { registrationId: 'registration-1', actor: volunteer, now: NOW });

    expect(result.registration).toMatchObject({ id: 'registration-1', status: 'CANCELLED' });
    expect(db.registrations[0].status).toBe('CANCELLED');
    expect(db.refunds).toEqual([
      expect.objectContaining({
        paymentId: 'payment-1',
        amount: 100_000,
        reason: 'Volunteer membatalkan Registrasi',
        requestedById: 'volunteer-1',
        status: 'REQUESTED',
      }),
    ]);
    expect(result.refund).toMatchObject({ id: db.refunds[0].id, amount: 100_000, status: 'REQUESTED' });
  });

  it('locks Trip, then the Registration, then the Payment', async () => {
    const db = paidRegistration(30);

    await cancelRegistration(db.prisma as never, { registrationId: 'registration-1', actor: volunteer, now: NOW });

    expect(db.rowLocks).toEqual([
      'VolunteerTrip:trip-1',
      'Registration:registration-1',
      'VolunteerTrip:trip-1',
      'Payment:payment-1',
    ]);
  });

  it('refunds half inside the middle tier', async () => {
    const db = paidRegistration(5);

    const result = await cancelRegistration(db.prisma as never, { registrationId: 'registration-1', actor: volunteer, now: NOW });

    expect(result.refund).toMatchObject({ amount: 50_000 });
  });

  it('cancels inside the no-refund window with no Refund, never the Batch-cancel full refund', async () => {
    const db = paidRegistration(1);

    const result = await cancelRegistration(db.prisma as never, { registrationId: 'registration-1', actor: volunteer, now: NOW });

    expect(db.registrations[0].status).toBe('CANCELLED');
    expect(result.refund).toBeNull();
    expect(db.refunds).toEqual([]);
  });

  it('cancels a HOLD Registration with no Refund: nothing has been paid', async () => {
    const db = makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batchRow()],
      registrations: [registrationRow({ status: 'HOLD' })],
    });

    const result = await cancelRegistration(db.prisma as never, { registrationId: 'registration-1', actor: volunteer, now: NOW });

    expect(db.registrations[0].status).toBe('CANCELLED');
    expect(result.refund).toBeNull();
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1', 'Registration:registration-1']);
  });

  it.each([
    ['a Registration that does not exist', { registrationId: 'nope' }, 'REGISTRATION_NOT_FOUND', 404],
    ["another Volunteer's Registration", { actor: { userId: 'someone-else' } }, 'REGISTRATION_NOT_FOUND', 404],
    ['a CANCELLED Registration', { registration: registrationRow({ status: 'CANCELLED' }) }, 'REGISTRATION_NOT_CANCELLABLE', 400],
    ['an EXPIRED Registration', { registration: registrationRow({ status: 'EXPIRED' }) }, 'REGISTRATION_NOT_CANCELLABLE', 400],
    ['a Registration on a COMPLETED Batch', { batch: batchRow({ status: 'COMPLETED' }) }, 'BATCH_ALREADY_COMPLETED', 400],
  ] as const)('refuses %s, changing and refunding nothing', async (_label, setup, code, status) => {
    const fields = setup as {
      registrationId?: string;
      actor?: { userId: string };
      registration?: ReturnType<typeof registrationRow>;
      batch?: ReturnType<typeof batchRow>;
    };
    const registration = fields.registration ?? registrationRow();
    const db = makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [fields.batch ?? batchRow()],
      registrations: [registration],
      payments: [paymentRow()],
    });

    const error = await cancelRegistration(db.prisma as never, {
      registrationId: fields.registrationId ?? 'registration-1',
      actor: fields.actor ?? volunteer,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(domainErrorToHttp(error)).toMatchObject({ status, body: { code } });
    expect(db.registrations[0].status).toBe(registration.status);
    expect(db.refunds).toEqual([]);
  });

  it("answers another Volunteer's Registration exactly as one that does not exist (status and body), and cancels nothing", async () => {
    const db = makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batchRow()],
      registrations: [registrationRow()],
      payments: [paymentRow()],
    });
    const refuse = (registrationId: string, userId: string) =>
      cancelRegistration(db.prisma as never, { registrationId, actor: { userId }, now: NOW }).catch((e: unknown) =>
        domainErrorToHttp(e),
      );

    const notOwner = await refuse('registration-1', 'someone-else');
    const missing = await refuse('registration-nope', 'someone-else');

    expect(notOwner).toEqual(missing);
    expect(notOwner).toMatchObject({ status: 404 });
    expect(JSON.stringify(notOwner)).not.toContain('registration-1');
    expect(db.registrations[0].status).toBe('CONFIRMED');
    expect(db.refunds).toEqual([]);
  });

  it('refuses, refunding nothing twice, when another cancel committed before this one got the lock', async () => {
    const db = paidRegistration(30);
    db.beforeNextRowLock((data) => {
      data.registrations[0].status = 'CANCELLED';
    });

    const error = await cancelRegistration(db.prisma as never, {
      registrationId: 'registration-1',
      actor: volunteer,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(domainErrorToHttp(error)).toMatchObject({ status: 400, body: { code: 'REGISTRATION_NOT_CANCELLABLE' } });
    expect(db.refunds).toEqual([]);
  });
});

describe('confirmRegistration (inside the Settlement transaction)', () => {
  function withRegistration(status: 'HOLD' | 'CANCELLED' | 'EXPIRED') {
    return makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batchRow()],
      registrations: [registrationRow({ status })],
    });
  }

  it('confirms a HOLD Registration, taking no lock of its own', async () => {
    const db = withRegistration('HOLD');

    const result = await confirmRegistration(db.prisma as never, { registrationId: 'registration-1' });

    expect(result).toEqual({ outcome: 'confirmed' });
    expect(db.registrations[0].status).toBe('CONFIRMED');
    expect(db.rowLocks).toEqual([]);
  });

  it('reports a Registration cancelled before its Trip Fee settled, leaving it cancelled', async () => {
    const db = withRegistration('CANCELLED');

    const result = await confirmRegistration(db.prisma as never, { registrationId: 'registration-1' });

    expect(result).toEqual({ outcome: 'cancelled' });
    expect(db.registrations[0].status).toBe('CANCELLED');
  });

  it('confirms a HOLD whose window has not yet closed when the Trip Fee settles', async () => {
    const db = makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batchRow()],
      registrations: [registrationRow({ status: 'HOLD', holdExpiresAt: new Date(NOW.getTime() + 1_000) })],
    });

    const result = await confirmRegistration(db.prisma as never, { registrationId: 'registration-1' });

    expect(result).toEqual({ outcome: 'confirmed' });
    expect(db.registrations[0].status).toBe('CONFIRMED');
  });

  it('reports a hold that lapsed before its Trip Fee settled, leaving it expired', async () => {
    const db = withRegistration('EXPIRED');

    const result = await confirmRegistration(db.prisma as never, { registrationId: 'registration-1' });

    expect(result).toEqual({ outcome: 'lapsed' });
    expect(db.registrations[0].status).toBe('EXPIRED');
  });
});

describe('expireRegistrationHold (inside the Payment-lapsed transaction)', () => {
  it.each([
    ['HOLD', 'EXPIRED'],
    ['CANCELLED', 'CANCELLED'],
    ['CONFIRMED', 'CONFIRMED'],
  ] as const)('leaves a %s Registration %s', async (from, to) => {
    const db = makeTripDb({ batches: [batchRow()], registrations: [registrationRow({ status: from })] });

    await expireRegistrationHold(db.prisma as never, { registrationId: 'registration-1' });

    expect(db.registrations[0].status).toBe(to);
  });
});

describe('refundLateSettlement', () => {
  function settledAfterCancel(status: 'CANCELLED' | 'EXPIRED' | 'CONFIRMED' = 'CANCELLED') {
    return makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      // Departed long ago: the full Refund owes nothing to timing.
      batches: [batchRow({ startDate: new Date(NOW.getTime() - 10 * DAY_MS) })],
      registrations: [registrationRow({ status })],
      payments: [paymentRow({ amount: 250_000 })],
    });
  }

  it('refunds the full Trip Fee of a cancelled Registration, requested by its Volunteer', async () => {
    const db = settledAfterCancel();

    const result = await refundLateSettlement(db.prisma as never, { registrationId: 'registration-1', now: NOW });

    expect(db.refunds).toEqual([
      expect.objectContaining({
        paymentId: 'payment-1',
        amount: 250_000,
        reason: 'Trip Fee settlement arrived after the Registration was already cancelled -- refunded automatically',
        requestedById: 'volunteer-1',
        status: 'REQUESTED',
      }),
    ]);
    expect(result.refund).toMatchObject({ id: db.refunds[0].id, amount: 250_000 });
    expect(db.rowLocks).toEqual([
      'VolunteerTrip:trip-1',
      'Registration:registration-1',
      'VolunteerTrip:trip-1',
      'Payment:payment-1',
    ]);
  });

  it('refunds the full Trip Fee of an expired Registration, whose hold lapsed before the fee settled', async () => {
    const db = settledAfterCancel('EXPIRED');

    const result = await refundLateSettlement(db.prisma as never, { registrationId: 'registration-1', now: NOW });

    expect(db.refunds).toEqual([
      expect.objectContaining({
        paymentId: 'payment-1',
        amount: 250_000,
        reason: 'Trip Fee settlement arrived after the seat hold had expired -- refunded automatically',
        requestedById: 'volunteer-1',
        status: 'REQUESTED',
      }),
    ]);
    expect(result.refund).toMatchObject({ id: db.refunds[0].id, amount: 250_000 });
    // The seat is not handed out: the Registration stays EXPIRED.
    expect(db.registrations[0].status).toBe('EXPIRED');
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'never refunds a %s Registration twice: a replay is refused by the remaining-amount guard',
    async (status) => {
      const db = settledAfterCancel(status);
      await refundLateSettlement(db.prisma as never, { registrationId: 'registration-1', now: NOW });

      await expect(
        refundLateSettlement(db.prisma as never, { registrationId: 'registration-1', now: NOW }),
      ).rejects.toBeInstanceOf(RefundExceedsRemainingError);

      expect(db.refunds).toHaveLength(1);
      expect(db.refunds[0].amount).toBe(250_000);
    },
  );

  it('refunds nothing for a CONFIRMED Registration', async () => {
    const db = settledAfterCancel('CONFIRMED');

    const result = await refundLateSettlement(db.prisma as never, { registrationId: 'registration-1', now: NOW });

    expect(result.refund).toBeNull();
    expect(db.refunds).toEqual([]);
  });
});
