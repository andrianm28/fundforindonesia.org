import { describe, it, expect } from 'vitest';
import { holdRegistration, liftTripSuspension, suspendTrip } from './trip';
import {
  TripNotFoundError,
  TripNotSuspendableError,
  TripNotSuspendedError,
  TripNotTakingRegistrationsError,
  TripSuspensionUnrecordedError,
} from '@/lib/volunteer-trip-errors';
import { LifecycleValidationError, SameAdminLiftError } from '@/lib/campaign-lifecycle-errors';
import { NotAuthorizedError, OwnSubjectConflictError } from '@/lib/capacity';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { batchRow, makeTripDb, registrationRow, tripRow } from '../../../tests/support/in-memory-trip-db';

const NOW = new Date('2026-09-30T10:00:00Z');
const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };
const otherAdmin = { userId: 'admin-2', assignments: ['ADMIN' as const] };
const REASON = 'Laporan penyalahgunaan dana peserta.';

function suspendedDb(suspendedBy = 'admin-1') {
  const db = makeTripDb({ trips: [tripRow({ status: 'SUSPENDED' })] });
  db.statusChanges.push({
    id: 'seed-1',
    tripId: 'trip-1',
    action: 'SUSPENDED',
    fromStatus: 'ACTIVE',
    toStatus: 'SUSPENDED',
    actorId: suspendedBy,
    capacity: 'ADMIN',
    reason: 'Awal',
    createdAt: new Date('2026-09-29T10:00:00Z'),
  });
  return db;
}

describe('suspendTrip', () => {
  it('suspends an Active Trip, logs the Admin, the reason and the change in the same write, and tells the Fundraiser', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })] });

    const result = await suspendTrip(db.prisma as never, {
      tripId: 'trip-1',
      actor: admin,
      reason: `  ${REASON}  `,
      now: NOW,
    });

    expect(result.trip).toMatchObject({ id: 'trip-1', status: 'SUSPENDED' });
    expect(db.trip().status).toBe('SUSPENDED');
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        tripId: 'trip-1',
        action: 'SUSPENDED',
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        actorId: 'admin-1',
        capacity: 'ADMIN',
        reason: REASON,
        createdAt: NOW,
      }),
    ]);
    expect(db.notifications).toEqual([
      expect.objectContaining({ userId: 'fundraiser-1', message: expect.stringContaining(REASON) }),
    ]);
  });

  it.each([undefined, null, '', '   ', 42])('requires a reason: %j is a 400 VALIDATION and writes nothing', async (reason) => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })] });

    const error = await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor: admin, reason, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
    expect(db.trip().status).toBe('ACTIVE');
    expect(db.statusChanges).toEqual([]);
  });

  it('refuses a reason over 1000 characters', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })] });
    const error = await suspendTrip(db.prisma as never, {
      tripId: 'trip-1',
      actor: admin,
      reason: 'x'.repeat(1001),
      now: NOW,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(db.trip().status).toBe('ACTIVE');
  });

  it.each([
    ['a Verifier', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
    ['a user with no assignment', { userId: 'someone', assignments: [] }],
    ['the Trip Fundraiser with no assignment', { userId: 'fundraiser-1', assignments: [] }],
  ])('refuses %s with a 403 NOT_AUTHORIZED: only an Admin suspends', async (_who, actor) => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })] });

    const error = await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor, reason: REASON, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(domainErrorToHttp(error)?.status).toBe(403);
    expect(db.trip().status).toBe('ACTIVE');
    expect(db.statusChanges).toEqual([]);
  });

  it('never lets an Admin suspend their own Trip: 403 OWN_TRIP_CONFLICT, nothing written', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE', fundraiserId: 'admin-1' })] });

    const error = await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor: admin, reason: REASON, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(OwnSubjectConflictError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 403, body: { code: 'OWN_TRIP_CONFLICT' } });
    expect(db.trip().status).toBe('ACTIVE');
    expect(db.statusChanges).toEqual([]);
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'SUSPENDED', 'CANCELLED', 'COMPLETED'] as const)(
    'refuses a %s Trip with a 409 TRIP_NOT_SUSPENDABLE, writing nothing',
    async (status) => {
      const db = makeTripDb({ trips: [tripRow({ status })] });

      const error = await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor: admin, reason: REASON, now: NOW }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(TripNotSuspendableError);
      expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'TRIP_NOT_SUSPENDABLE' } });
      expect(db.trip().status).toBe(status);
      expect(db.statusChanges).toEqual([]);
    },
  );

  it('refuses an unknown Trip with a 404', async () => {
    const db = makeTripDb({ trips: [] });
    const error = await suspendTrip(db.prisma as never, { tripId: 'nope', actor: admin, reason: REASON, now: NOW }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TripNotFoundError);
  });

  it('takes the Trip row lock, and judges a suspension committed before it: the second is a 409', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })] });
    db.beforeNextRowLock((data) => {
      data.trips[0].status = 'SUSPENDED';
    });

    const error = await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor: admin, reason: REASON, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1']);
    expect(error).toBeInstanceOf(TripNotSuspendableError);
    expect(db.statusChanges).toEqual([]);
  });

  it('leaves existing Registrations alone: a CONFIRMED one stays CONFIRMED, with no refund', async () => {
    const db = makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batchRow()],
      registrations: [registrationRow({ status: 'CONFIRMED' })],
    });

    await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor: admin, reason: REASON, now: NOW });

    expect(db.registrations.map((r) => r.status)).toEqual(['CONFIRMED']);
    expect(db.batch().status).toBe('OPEN');
    expect(db.refunds).toEqual([]);
  });

  it('stops new Registrations: holdRegistration on a Suspended Trip is refused and creates nothing', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })], batches: [batchRow()] });
    await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor: admin, reason: REASON, now: NOW });

    const error = await holdRegistration(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      volunteerId: 'volunteer-9',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TripNotTakingRegistrationsError);
    expect(db.registrations).toEqual([]);
  });
});

describe('liftTripSuspension', () => {
  it('lets a different Admin lift it: the Trip returns to Active, logged with the reason, and the Fundraiser is told', async () => {
    const db = suspendedDb('admin-1');

    const result = await liftTripSuspension(db.prisma as never, {
      tripId: 'trip-1',
      actor: otherAdmin,
      reason: REASON,
      now: NOW,
    });

    expect(result.trip).toMatchObject({ status: 'ACTIVE' });
    expect(db.trip().status).toBe('ACTIVE');
    expect(db.statusChanges.at(-1)).toEqual(
      expect.objectContaining({
        action: 'SUSPENSION_LIFTED',
        fromStatus: 'SUSPENDED',
        toStatus: 'ACTIVE',
        actorId: 'admin-2',
        capacity: 'ADMIN',
        reason: REASON,
        createdAt: NOW,
      }),
    );
    expect(db.notifications).toEqual([expect.objectContaining({ userId: 'fundraiser-1' })]);
  });

  it('takes registrations again once lifted', async () => {
    const db = suspendedDb('admin-1');
    db.batches.push(batchRow());
    await liftTripSuspension(db.prisma as never, { tripId: 'trip-1', actor: otherAdmin, reason: REASON, now: NOW });

    const held = await holdRegistration(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      volunteerId: 'volunteer-9',
      now: NOW,
    });

    expect(held.registration.status).toBe('HOLD');
  });

  it('refuses the Admin who imposed the latest Suspension: 403 SAME_ADMIN_LIFT, nothing written', async () => {
    const db = suspendedDb('admin-1');

    const error = await liftTripSuspension(db.prisma as never, {
      tripId: 'trip-1',
      actor: admin,
      reason: REASON,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SameAdminLiftError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 403, body: { code: 'SAME_ADMIN_LIFT' } });
    expect(db.trip().status).toBe('SUSPENDED');
    expect(db.statusChanges).toHaveLength(1);
  });

  it('requires a reason', async () => {
    const db = suspendedDb();
    const error = await liftTripSuspension(db.prisma as never, {
      tripId: 'trip-1',
      actor: otherAdmin,
      reason: ' ',
      now: NOW,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(db.trip().status).toBe('SUSPENDED');
  });

  it.each([
    ['a Verifier', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
    ['a user with no assignment', { userId: 'someone', assignments: [] }],
  ])('refuses %s: only an Admin lifts', async (_who, actor) => {
    const db = suspendedDb();
    const error = await liftTripSuspension(db.prisma as never, { tripId: 'trip-1', actor, reason: REASON, now: NOW }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(db.trip().status).toBe('SUSPENDED');
  });

  it('never lets an Admin lift the Suspension of their own Trip', async () => {
    const db = suspendedDb('admin-1');
    db.trip().fundraiserId = 'admin-2';

    const error = await liftTripSuspension(db.prisma as never, {
      tripId: 'trip-1',
      actor: otherAdmin,
      reason: REASON,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OwnSubjectConflictError);
    expect(db.trip().status).toBe('SUSPENDED');
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'ACTIVE', 'CANCELLED', 'COMPLETED'] as const)(
    'refuses a %s Trip with a 409 TRIP_NOT_SUSPENDED',
    async (status) => {
      const db = makeTripDb({ trips: [tripRow({ status })] });
      const error = await liftTripSuspension(db.prisma as never, {
        tripId: 'trip-1',
        actor: otherAdmin,
        reason: REASON,
        now: NOW,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TripNotSuspendedError);
      expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'TRIP_NOT_SUSPENDED' } });
      expect(db.trip().status).toBe(status);
      expect(db.statusChanges).toEqual([]);
    },
  );

  it('refuses a Suspension with no log row rather than guessing the status to return to', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'SUSPENDED' })] });
    const error = await liftTripSuspension(db.prisma as never, {
      tripId: 'trip-1',
      actor: otherAdmin,
      reason: REASON,
      now: NOW,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TripSuspensionUnrecordedError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'TRIP_SUSPENSION_UNRECORDED' } });
    expect(db.trip().status).toBe('SUSPENDED');
  });

  it('judges the latest Suspension: after suspend, lift, suspend again by admin-2, admin-1 may lift', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })] });
    await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor: admin, reason: REASON, now: new Date('2026-09-30T10:00:00Z') });
    await liftTripSuspension(db.prisma as never, { tripId: 'trip-1', actor: otherAdmin, reason: REASON, now: new Date('2026-09-30T11:00:00Z') });
    await suspendTrip(db.prisma as never, { tripId: 'trip-1', actor: otherAdmin, reason: REASON, now: new Date('2026-09-30T12:00:00Z') });

    await liftTripSuspension(db.prisma as never, { tripId: 'trip-1', actor: admin, reason: REASON, now: new Date('2026-09-30T13:00:00Z') });

    expect(db.trip().status).toBe('ACTIVE');
    expect(db.statusChanges.map((c) => c.action)).toEqual(['SUSPENDED', 'SUSPENSION_LIFTED', 'SUSPENDED', 'SUSPENSION_LIFTED']);
  });
});
