import { describe, it, expect } from 'vitest';
import { cancelBatch, completeBatch, createBatch, editBatch, type TripActor } from './trip';
import {
  BatchFieldsInvalidError,
  BatchLockedByRegistrationsError,
  BatchQuotaBelowSeatsError,
  BatchMinQuotaMetError,
  BatchNotEndedError,
  BatchNotFoundError,
  BatchNotOpenError,
  TripNotAcceptingBatchesError,
  TripNotFoundError,
} from '@/lib/volunteer-trip-errors';
import { NotAuthorizedError } from '@/lib/capacity';
import { refundTiers } from './refund-table';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { batchRow, makeTripDb, paymentRow, registrationRow, tripRow } from '../../../tests/support/in-memory-trip-db';

const NOW = new Date('2026-09-26T10:00:00Z');
const fundraiser = { userId: 'fundraiser-1', assignments: [] };
const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };
const stranger = { userId: 'someone-else', assignments: [] };

const FIELDS = {
  startDate: new Date('2026-12-01T00:00:00Z'),
  endDate: new Date('2026-12-05T00:00:00Z'),
  registrationDeadline: new Date('2026-11-20T00:00:00Z'),
  maxQuota: 20,
  minQuota: 8,
};

describe('createBatch', () => {
  it('adds an OPEN Batch to the Fundraiser\'s Trip, locking the Trip first', async () => {
    const db = makeTripDb({ trips: [tripRow()] });

    const { batch } = await createBatch(db.prisma as never, {
      tripId: 'trip-1',
      actor: fundraiser,
      fields: FIELDS,
      now: NOW,
    });

    expect(batch).toMatchObject({ tripId: 'trip-1', status: 'OPEN', ...FIELDS });
    expect(db.batches).toEqual([expect.objectContaining({ id: batch.id, status: 'OPEN', maxQuota: 20, minQuota: 8 })]);
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1']);
  });

  it('lets an Admin add a Batch to a Trip they do not own', async () => {
    const db = makeTripDb({ trips: [tripRow()] });
    const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };

    await createBatch(db.prisma as never, { tripId: 'trip-1', actor: admin, fields: FIELDS, now: NOW });

    expect(db.batches).toHaveLength(1);
  });

  it('refuses anyone who is neither the Fundraiser nor an Admin with a 403, adding nothing', async () => {
    const db = makeTripDb({ trips: [tripRow()] });
    const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };

    const error = await createBatch(db.prisma as never, {
      tripId: 'trip-1',
      actor: verifier,
      fields: FIELDS,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(domainErrorToHttp(error)).toEqual({
      status: 403,
      body: { error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.', code: 'NOT_AUTHORIZED' },
    });
    expect(db.batches).toEqual([]);
  });

  it('refuses a Trip that does not exist with a 404', async () => {
    const db = makeTripDb();

    const error = await createBatch(db.prisma as never, {
      tripId: 'trip-1',
      actor: fundraiser,
      fields: FIELDS,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TripNotFoundError);
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'ACTIVE', 'SUSPENDED'] as const)('adds a Batch to a %s Trip', async (status) => {
    const db = makeTripDb({ trips: [tripRow({ status })] });

    await createBatch(db.prisma as never, { tripId: 'trip-1', actor: fundraiser, fields: FIELDS, now: NOW });

    expect(db.batches).toHaveLength(1);
  });

  it.each(['CANCELLED', 'COMPLETED'] as const)('refuses a %s Trip with a 400, adding nothing', async (status) => {
    const db = makeTripDb({ trips: [tripRow({ status })] });

    const error = await createBatch(db.prisma as never, {
      tripId: 'trip-1',
      actor: fundraiser,
      // Inconsistent too: the Trip's status is judged first, as before.
      fields: { ...FIELDS, minQuota: 25 },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TripNotAcceptingBatchesError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 400, body: { code: 'TRIP_NOT_ACCEPTING_BATCHES' } });
    expect(db.batches).toEqual([]);
  });

  it.each([
    ['minQuota above maxQuota', { minQuota: 25 }, 'minQuota', 'Kuota minimum tidak boleh melebihi kuota maksimum.'],
    ['endDate before startDate', { endDate: new Date('2026-11-30T00:00:00Z') }, 'endDate', 'Tanggal selesai tidak boleh sebelum tanggal mulai.'],
    [
      'registrationDeadline after startDate',
      { registrationDeadline: new Date('2026-12-02T00:00:00Z') },
      'registrationDeadline',
      'Tenggat pendaftaran tidak boleh setelah tanggal mulai.',
    ],
  ])('refuses %s with a 400 naming the field, in the form\'s own words, adding nothing', async (_, override, field, message) => {
    const db = makeTripDb({ trips: [tripRow()] });

    const error = await createBatch(db.prisma as never, {
      tripId: 'trip-1',
      actor: fundraiser,
      fields: { ...FIELDS, ...override },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchFieldsInvalidError);
    expect((error as BatchFieldsInvalidError).field).toBe(field);
    expect((error as BatchFieldsInvalidError).message).toBe(message);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 400, body: { code: 'BATCH_FIELDS_INVALID' } });
    expect(db.batches).toEqual([]);
  });
});

describe('completeBatch', () => {
  const ended = batchRow({ endDate: new Date('2026-09-20T00:00:00Z') });

  it('completes an OPEN Batch whose endDate has passed, locking the Trip then the Batch', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })], batches: [ended] });

    const { batch } = await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      attendedRegistrationIds: [],
      now: NOW,
    });

    expect(batch).toMatchObject({ id: 'batch-1', status: 'COMPLETED' });
    expect(db.batch().status).toBe('COMPLETED');
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1', 'VolunteerBatch:batch-1']);
  });

  it('refuses an Admin who does not own the Trip with a 403, leaving the Batch OPEN', async () => {
    const db = makeTripDb({ trips: [tripRow()], batches: [ended] });

    const error = await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: admin,
      attendedRegistrationIds: [],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(db.batch().status).toBe('OPEN');
  });

  it('refuses someone who is neither the Fundraiser nor an Admin with a 403, before locking the Batch', async () => {
    const db = makeTripDb({ trips: [tripRow()], batches: [ended] });

    const error = await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: stranger,
      attendedRegistrationIds: [],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(db.batch().status).toBe('OPEN');
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1']);
  });

  it.each([
    ['does not exist', []],
    ['belongs to another Trip', [batchRow({ tripId: 'trip-2', endDate: ended.endDate })]],
  ])('refuses a Batch that %s with a 404', async (_, batches) => {
    const db = makeTripDb({ trips: [tripRow(), tripRow({ id: 'trip-2', slug: 'lain' })], batches });

    const error = await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      attendedRegistrationIds: [],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchNotFoundError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 404, body: { code: 'BATCH_NOT_FOUND' } });
    // Another Trip's Batch is never locked without that Trip's lock.
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1']);
  });

  it.each(['CLOSED', 'CANCELLED', 'COMPLETED'] as const)('refuses a %s Batch with a 409', async (status) => {
    const db = makeTripDb({ trips: [tripRow()], batches: [{ ...ended, status }] });

    const error = await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      attendedRegistrationIds: [],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchNotOpenError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'BATCH_NOT_OPEN' } });
    expect(db.batch().status).toBe(status);
  });

  it('refuses a Batch whose endDate has not passed with a 400', async () => {
    const db = makeTripDb({ trips: [tripRow()], batches: [batchRow()] });

    const error = await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      attendedRegistrationIds: [],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchNotEndedError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 400, body: { code: 'BATCH_NOT_ENDED' } });
    expect(db.batch().status).toBe('OPEN');
  });

  it('refuses with a 409 when a cancel committed before this call got the Trip lock', async () => {
    const db = makeTripDb({ trips: [tripRow()], batches: [ended] });
    db.beforeNextRowLock((data) => {
      data.batches[0].status = 'CANCELLED';
    });

    const error = await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      attendedRegistrationIds: [],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchNotOpenError);
    expect(db.batch().status).toBe('CANCELLED');
  });
});

describe('completeBatch leaves no HOLD behind (ticket 53)', () => {
  const ended = batchRow({ endDate: new Date('2026-09-20T00:00:00Z') });
  const seed = () =>
    makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [ended],
      registrations: [
        registrationRow({ id: 'held', volunteerId: 'v-held', status: 'HOLD' }),
        registrationRow({ id: 'paid', volunteerId: 'v-paid', status: 'CONFIRMED' }),
        registrationRow({ id: 'gone', volunteerId: 'v-gone', status: 'CANCELLED' }),
      ],
    });

  it('expires every HOLD and leaves CONFIRMED and CANCELLED Registrations as they were', async () => {
    const db = seed();

    await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      attendedRegistrationIds: ['paid'],
      now: NOW,
    });

    const status = (id: string) => db.registrations.find((r) => r.id === id)!.status;
    expect(status('held')).toBe('EXPIRED');
    expect(status('paid')).toBe('CONFIRMED');
    expect(status('gone')).toBe('CANCELLED');
  });

  it('leaves the HOLD alone when the completion is refused', async () => {
    const db = seed();

    await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      attendedRegistrationIds: ['held'],
      now: NOW,
    }).catch(() => undefined);

    expect(db.registrations.find((r) => r.id === 'held')!.status).toBe('HOLD');
    expect(db.batch().status).toBe('OPEN');
  });
});

describe('completeBatch attendance (ticket 35)', () => {
  const ended = batchRow({ endDate: new Date('2026-09-20T00:00:00Z') });
  const confirmed = (id: string, overrides = {}) => registrationRow({ id, volunteerId: `v-${id}`, ...overrides });
  const seed = () =>
    makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [ended],
      registrations: [
        confirmed('r1'),
        confirmed('r2'),
        confirmed('r3'),
        confirmed('r4', { status: 'CANCELLED' }),
      ],
      payments: [paymentRow({ id: 'p1', registrationId: 'r1' })],
    });
  const complete = (db: ReturnType<typeof seed>, ids: string[], actor: TripActor = fundraiser) =>
    completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor,
      attendedRegistrationIds: ids,
      now: NOW,
    });
  const attendedIds = (db: ReturnType<typeof seed>) =>
    db.registrations.filter((r) => r.attended).map((r) => r.id).sort();

  it('marks only the listed CONFIRMED Registrations attended; the rest stay false', async () => {
    const db = seed();
    await complete(db, ['r1', 'r3']);
    expect(attendedIds(db)).toEqual(['r1', 'r3']);
    expect(db.batch().status).toBe('COMPLETED');
  });

  it('an empty list from the owner means nobody attended, and still locks the live Registrations', async () => {
    const db = seed();
    await complete(db, []);
    expect(attendedIds(db)).toEqual([]);
    expect(db.batch().status).toBe('COMPLETED');
    expect(db.rowLocks).toEqual([
      'VolunteerTrip:trip-1',
      'VolunteerBatch:batch-1',
      'Registration:r1',
      'Registration:r2',
      'Registration:r3',
    ]);
  });

  it('locks the Trip, the Batch, then the live Registrations', async () => {
    const db = seed();
    await complete(db, ['r1']);
    expect(db.rowLocks).toEqual([
      'VolunteerTrip:trip-1',
      'VolunteerBatch:batch-1',
      'Registration:r1',
      'Registration:r2',
      'Registration:r3',
    ]);
  });

  it('writes no Refund and no ledger row', async () => {
    const db = seed();
    await complete(db, ['r1', 'r2']);
    expect(db.refunds).toEqual([]);
    expect(db.ledgerEntries).toEqual([]);
  });

  it.each([
    ['a cancelled Registration', 'r4'],
    ['an unknown id', 'nope'],
  ])('refuses %s in the list with a 400, changing nothing', async (_, id) => {
    const db = seed();
    const error = await complete(db, ['r1', id]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BatchFieldsInvalidError);
    expect((error as BatchFieldsInvalidError).field).toBe('attendedRegistrationIds');
    expect(attendedIds(db)).toEqual([]);
    expect(db.batch().status).toBe('OPEN');
  });

  it('refuses a Registration of another Batch', async () => {
    const db = makeTripDb({
      trips: [tripRow()],
      batches: [ended, batchRow({ id: 'batch-2', endDate: ended.endDate })],
      registrations: [confirmed('r1'), confirmed('x1', { batchId: 'batch-2' })],
    });
    const error = await complete(db as never, ['x1']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BatchFieldsInvalidError);
    expect(attendedIds(db as never)).toEqual([]);
  });

  it('lets only the Trip\'s own Fundraiser mark attendance: an Admin who does not own it is refused', async () => {
    const db = seed();
    const error = await complete(db, ['r1'], admin).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(attendedIds(db)).toEqual([]);
    expect(db.batch().status).toBe('OPEN');
  });

  it('refuses a stranger and an Admin-owner mix-up the same way: a non-owner holding ADMIN is still refused', async () => {
    const db = seed();
    const error = await complete(db, [], stranger).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotAuthorizedError);
  });

  it('an Admin who owns the Trip marks attendance as its Fundraiser', async () => {
    const db = makeTripDb({
      trips: [tripRow({ fundraiserId: 'admin-1' })],
      batches: [ended],
      registrations: [confirmed('r1')],
    });
    await complete(db as never, ['r1'], admin);
    expect(attendedIds(db as never)).toEqual(['r1']);
  });

  it('refuses before the endDate even with a list, marking no one', async () => {
    const db = makeTripDb({ trips: [tripRow()], batches: [batchRow()], registrations: [confirmed('r1')] });
    const error = await complete(db as never, ['r1']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BatchNotEndedError);
    expect(attendedIds(db as never)).toEqual([]);
  });

  it('does not change attendance on a Batch that is already COMPLETED', async () => {
    const db = makeTripDb({
      trips: [tripRow()],
      batches: [{ ...ended, status: 'COMPLETED' }],
      registrations: [confirmed('r1', { attended: true }), confirmed('r2')],
    });
    const error = await complete(db as never, ['r2']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BatchNotOpenError);
    expect(attendedIds(db as never)).toEqual(['r1']);
  });
});

describe('editBatch', () => {
  it('changes an OPEN Batch\'s dates and quotas, locking the Trip then the Batch', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })], batches: [batchRow()] });

    const { batch } = await editBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      edits: { maxQuota: 25, endDate: new Date('2026-12-09T00:00:00Z') },
      now: NOW,
    });

    expect(batch).toMatchObject({ maxQuota: 25, minQuota: 8, endDate: new Date('2026-12-09T00:00:00Z'), status: 'OPEN' });
    expect(db.batch()).toMatchObject({ maxQuota: 25, endDate: new Date('2026-12-09T00:00:00Z') });
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1', 'VolunteerBatch:batch-1']);
  });

  it.each([
    ['minQuota above maxQuota', { minQuota: 99 }, 'minQuota', 'Kuota minimum tidak boleh melebihi kuota maksimum.'],
    ['endDate before startDate', { endDate: new Date('2026-11-30T00:00:00Z') }, 'endDate', 'Tanggal selesai tidak boleh sebelum tanggal mulai.'],
    [
      'registrationDeadline after startDate',
      { registrationDeadline: new Date('2026-12-02T00:00:00Z') },
      'registrationDeadline',
      'Tenggat pendaftaran tidak boleh setelah tanggal mulai.',
    ],
  ])('refuses an edit leaving %s, in Indonesian words with no field identifiers', async (_, edits, field, message) => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })], batches: [batchRow()] });

    const error = await editBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      edits,
      now: NOW,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(BatchFieldsInvalidError);
    expect((error as BatchFieldsInvalidError).field).toBe(field);
    expect((error as BatchFieldsInvalidError).message).toBe(message);
    expect((error as BatchFieldsInvalidError).message).not.toMatch(/minQuota|maxQuota|startDate|endDate|registrationDeadline/);
  });

  it('lets an Admin who does not own the Trip edit a Batch', async () => {
    const db = makeTripDb({ trips: [tripRow()], batches: [batchRow()] });

    await editBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: admin,
      edits: { maxQuota: 30 },
      now: NOW,
    });

    expect(db.batch().maxQuota).toBe(30);
  });

  it('refuses someone who is neither the Fundraiser nor an Admin with a 403, changing nothing', async () => {
    const db = makeTripDb({ trips: [tripRow()], batches: [batchRow()] });

    const error = await editBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: stranger,
      edits: { maxQuota: 30 },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(db.batch().maxQuota).toBe(20);
  });

  it.each(['CLOSED', 'CANCELLED', 'COMPLETED'] as const)('refuses a %s Batch with a 409', async (status) => {
    const db = makeTripDb({ trips: [tripRow()], batches: [batchRow({ status })] });

    const error = await editBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      edits: { maxQuota: 30 },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchNotOpenError);
    expect(db.batch().maxQuota).toBe(20);
  });

  it.each([
    ['a minQuota above the stored maxQuota', { minQuota: 30 }, 'minQuota'],
    ['an endDate before the stored startDate', { endDate: new Date('2026-11-25T00:00:00Z') }, 'endDate'],
    [
      'a registrationDeadline after the stored startDate',
      { registrationDeadline: new Date('2026-12-02T00:00:00Z') },
      'registrationDeadline',
    ],
  ])('refuses %s with a 400 naming the field, changing nothing', async (_, edits, field) => {
    const db = makeTripDb({ trips: [tripRow()], batches: [batchRow()] });

    const error = await editBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      edits,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchFieldsInvalidError);
    expect((error as BatchFieldsInvalidError).field).toBe(field);
    expect(db.batch()).toEqual(batchRow());
  });
});

describe('editBatch with Registrations (ticket 48)', () => {
  const PAST = new Date('2026-09-20T00:00:00Z');
  const SOON = new Date('2026-09-27T00:00:00Z');
  const edit = (db: ReturnType<typeof makeTripDb>, edits: Parameters<typeof editBatch>[1]['edits']) =>
    editBatch(db.prisma as never, { tripId: 'trip-1', batchId: 'batch-1', actor: fundraiser, edits, now: NOW }).catch(
      (e: unknown) => e,
    );
  const withRegistration = (status: 'CONFIRMED' | 'HOLD', holdExpiresAt = new Date('2026-09-26T10:30:00Z')) =>
    makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batchRow()],
      registrations: [registrationRow({ status, holdExpiresAt })],
    });

  it.each([
    ['rug-pull: startDate and endDate into the past', { startDate: PAST, endDate: PAST, registrationDeadline: PAST }, 'startDate'],
    ['startDate pulled under 3 days away', { startDate: SOON }, 'startDate'],
    ['endDate moved', { endDate: new Date('2026-12-30T00:00:00Z') }, 'endDate'],
    ['registrationDeadline moved', { registrationDeadline: new Date('2026-11-10T00:00:00Z') }, 'registrationDeadline'],
  ])('refuses %s once a Volunteer paid, with a 409, changing nothing', async (_, edits, field) => {
    const db = withRegistration('CONFIRMED');

    const error = await edit(db, edits);

    expect(error).toBeInstanceOf(BatchLockedByRegistrationsError);
    expect((error as BatchLockedByRegistrationsError).fields[0]).toBe(field);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'BATCH_LOCKED_BY_REGISTRATIONS' } });
    expect(db.batch()).toEqual(batchRow());
  });

  it('refuses startDate and endDate moved to an explicit past date once a Volunteer paid', async () => {
    const db = withRegistration('CONFIRMED');
    const pastStart = new Date('2026-09-01T00:00:00Z');
    const pastEnd = new Date('2026-09-05T00:00:00Z');

    const error = await edit(db, { startDate: pastStart, endDate: pastEnd, registrationDeadline: new Date('2026-08-25T00:00:00Z') });

    expect(error).toBeInstanceOf(BatchLockedByRegistrationsError);
    expect(db.batch()).toEqual(batchRow());
  });

  it('cannot be used to complete the Batch early: the edit is refused and completeBatch still waits for the real endDate', async () => {
    const db = withRegistration('CONFIRMED');
    const original = batchRow();
    expect(original.endDate.getTime()).toBeGreaterThan(NOW.getTime());

    const edited = await edit(db, { startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-05T00:00:00Z') });
    const completed = await completeBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      attendedRegistrationIds: [],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(edited).toBeInstanceOf(BatchLockedByRegistrationsError);
    expect(completed).toBeInstanceOf(BatchNotEndedError);
    expect(db.batch()).toEqual(original);
  });

  it('keeps the refund table on the frozen startDate after a refused edit', async () => {
    const db = withRegistration('CONFIRMED');
    const before = refundTiers({ startDate: db.batch().startDate, tripFee: 2_500_000 });

    await edit(db, { startDate: new Date('2026-09-01T00:00:00Z') });
    await edit(db, { startDate: new Date('2027-03-01T00:00:00Z'), endDate: new Date('2027-03-05T00:00:00Z') });

    expect(db.batch().startDate).toEqual(batchRow().startDate);
    expect(refundTiers({ startDate: db.batch().startDate, tripFee: 2_500_000 })).toEqual(before);
    expect(before[0].window).toContain('Sampai 17 Nov 2026 07.00 WIB');
  });

  it('names every locked field in the message, not just the first', async () => {
    const db = withRegistration('CONFIRMED');
    const error = await edit(db, { startDate: PAST, endDate: new Date('2026-12-30T00:00:00Z') });
    expect(error).toBeInstanceOf(BatchLockedByRegistrationsError);
    expect((error as BatchLockedByRegistrationsError).fields).toEqual(['startDate', 'endDate']);
    expect((error as BatchLockedByRegistrationsError).message).toContain('startDate, endDate');
  });

  it('also locks the dates for a HOLD that has not lapsed', async () => {
    const db = withRegistration('HOLD');
    expect(await edit(db, { startDate: SOON })).toBeInstanceOf(BatchLockedByRegistrationsError);
  });

  it('does not lock the dates for a lapsed HOLD, which no longer occupies a seat', async () => {
    const db = withRegistration('HOLD', NOW);
    const result = await edit(db, { startDate: new Date('2026-12-02T00:00:00Z'), endDate: new Date('2026-12-09T00:00:00Z') });
    expect(result).toHaveProperty('batch');
    expect(db.batch().startDate).toEqual(new Date('2026-12-02T00:00:00Z'));
  });

  it('lets fields that do not touch money change, and an unchanged date sent back as is', async () => {
    const db = withRegistration('CONFIRMED');
    await edit(db, { startDate: batchRow().startDate, maxQuota: 30, minQuota: 5 });
    expect(db.batch()).toMatchObject({ maxQuota: 30, minQuota: 5, startDate: batchRow().startDate });
  });

  it('refuses a maxQuota below the seats in use with a 422', async () => {
    const db = makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batchRow({ minQuota: 1 })],
      registrations: [
        registrationRow({ id: 'a', volunteerId: 'va' }),
        registrationRow({ id: 'b', volunteerId: 'vb' }),
        registrationRow({ id: 'c', volunteerId: 'vc', status: 'HOLD', holdExpiresAt: new Date('2026-09-26T10:30:00Z') }),
      ],
    });

    const error = await edit(db, { maxQuota: 2 });

    expect(error).toBeInstanceOf(BatchQuotaBelowSeatsError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 422, body: { code: 'BATCH_QUOTA_BELOW_SEATS' } });
    expect(await edit(db, { maxQuota: 3 })).toHaveProperty('batch');
  });

  it('refuses raising minQuota above the CONFIRMED count, which would let the Fundraiser cancel a Batch that ran', async () => {
    const db = withRegistration('CONFIRMED');
    db.batches[0].minQuota = 1;

    expect(await edit(db, { minQuota: 2 })).toBeInstanceOf(BatchQuotaBelowSeatsError);
    expect(db.batch().minQuota).toBe(1);
    expect(await edit(db, { minQuota: 1, maxQuota: 25 })).toHaveProperty('batch');
  });

  it('takes the live Registrations lock after Trip and Batch', async () => {
    const db = withRegistration('CONFIRMED');
    await edit(db, { maxQuota: 25 });
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1', 'VolunteerBatch:batch-1', 'Registration:registration-1']);
  });

  it('lets an empty Batch move to new future dates', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })], batches: [batchRow()] });
    const startDate = new Date('2026-10-20T00:00:00Z');
    await edit(db, { startDate, endDate: new Date('2026-10-25T00:00:00Z'), registrationDeadline: new Date('2026-10-10T00:00:00Z') });
    expect(db.batch().startDate).toEqual(startDate);
  });

  it.each([
    ['startDate', { startDate: PAST, endDate: new Date('2026-12-07T00:00:00Z'), registrationDeadline: PAST }],
    ['registrationDeadline', { registrationDeadline: PAST }],
    ['endDate', { startDate: PAST, endDate: PAST, registrationDeadline: PAST }],
  ])('refuses a past %s on an empty Batch with a 400', async (field, edits) => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })], batches: [batchRow()] });
    const error = await edit(db, edits);
    expect(error).toBeInstanceOf(BatchFieldsInvalidError);
    expect((error as BatchFieldsInvalidError).field).toBe(field === 'endDate' ? 'startDate' : field);
    expect(db.batch()).toEqual(batchRow());
  });

  it('createBatch refuses dates not after now', async () => {
    const db = makeTripDb({ trips: [tripRow()] });
    const error = await createBatch(db.prisma as never, {
      tripId: 'trip-1',
      actor: fundraiser,
      fields: { ...FIELDS, registrationDeadline: PAST, startDate: PAST, endDate: PAST },
      now: NOW,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BatchFieldsInvalidError);
    expect(db.batches).toEqual([]);
  });
});

describe('cancelBatch', () => {
  const REASON = 'Batch dibatalkan karena tidak mencapai kuota minimum';

  /** An under-quota Batch: two paid Registrations, one still on hold, one long expired. */
  function underQuota(batch = batchRow()) {
    return makeTripDb({
      trips: [tripRow({ status: 'ACTIVE' })],
      batches: [batch],
      registrations: [
        registrationRow({ id: 'reg-a', volunteerId: 'volunteer-a' }),
        registrationRow({ id: 'reg-b', volunteerId: 'volunteer-b' }),
        registrationRow({ id: 'reg-hold', volunteerId: 'volunteer-c', status: 'HOLD' }),
        registrationRow({ id: 'reg-expired', volunteerId: 'volunteer-d', status: 'EXPIRED' }),
      ],
      payments: [
        paymentRow({ id: 'payment-a', registrationId: 'reg-a', amount: 100_000 }),
        paymentRow({ id: 'payment-b', registrationId: 'reg-b', amount: 250_000 }),
      ],
    });
  }

  it('cancels the Batch and its live Registrations, refunding each paid one in full', async () => {
    const db = underQuota();

    const result = await cancelBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      now: NOW,
    });

    expect(result.batch).toMatchObject({ id: 'batch-1', status: 'CANCELLED' });
    expect(db.batch().status).toBe('CANCELLED');
    expect(Object.fromEntries(db.registrations.map((r) => [r.id, r.status]))).toEqual({
      'reg-a': 'CANCELLED',
      'reg-b': 'CANCELLED',
      'reg-hold': 'CANCELLED',
      'reg-expired': 'EXPIRED',
    });
    expect(db.refunds).toEqual([
      expect.objectContaining({ paymentId: 'payment-a', amount: 100_000, reason: REASON, requestedById: 'fundraiser-1', status: 'REQUESTED' }),
      expect.objectContaining({ paymentId: 'payment-b', amount: 250_000, reason: REASON, requestedById: 'fundraiser-1', status: 'REQUESTED' }),
    ]);
    expect(result.refunds).toEqual([
      { registrationId: 'reg-a', refundId: db.refunds[0].id, amount: 100_000 },
      { registrationId: 'reg-b', refundId: db.refunds[1].id, amount: 250_000 },
    ]);
    // Each Refund freezes its amount at once, from the Trip's escrow.
    expect(db.ledgerEntries.filter((e) => e.account === 'FROZEN_BALANCE')).toEqual([
      expect.objectContaining({ direction: 'CREDIT', amount: 100_000, volunteerTripId: 'trip-1' }),
      expect.objectContaining({ direction: 'CREDIT', amount: 250_000, volunteerTripId: 'trip-1' }),
    ]);
  });

  it('locks Trip, then Batch, then its Registrations, then each Payment', async () => {
    const db = underQuota();

    await cancelBatch(db.prisma as never, { tripId: 'trip-1', batchId: 'batch-1', actor: fundraiser, now: NOW });

    // Every lock, as taken. createRefund re-enters the Trip lock this
    // transaction already holds (waiting on nothing) before each Payment;
    // no Batch or Registration is ever locked after a Payment.
    expect(db.rowLocks).toEqual([
      'VolunteerTrip:trip-1',
      'VolunteerBatch:batch-1',
      'Registration:reg-a',
      'Registration:reg-b',
      'Registration:reg-hold',
      'VolunteerTrip:trip-1',
      'Payment:payment-a',
      'VolunteerTrip:trip-1',
      'Payment:payment-b',
    ]);
  });

  it('refunds the full Trip Fee even when the Batch departs tomorrow, never the tiered Volunteer-cancel rule', async () => {
    const db = underQuota(
      batchRow({
        startDate: new Date('2026-09-27T10:00:00Z'),
        endDate: new Date('2026-09-30T10:00:00Z'),
        registrationDeadline: new Date('2026-09-25T10:00:00Z'),
      }),
    );

    await cancelBatch(db.prisma as never, { tripId: 'trip-1', batchId: 'batch-1', actor: fundraiser, now: NOW });

    expect(db.refunds.map((r) => r.amount)).toEqual([100_000, 250_000]);
  });

  it('lets an Admin who does not own the Trip cancel, requesting the Refunds as themselves', async () => {
    const db = underQuota();

    await cancelBatch(db.prisma as never, { tripId: 'trip-1', batchId: 'batch-1', actor: admin, now: NOW });

    expect(db.batch().status).toBe('CANCELLED');
    expect(db.refunds.map((r) => r.requestedById)).toEqual(['admin-1', 'admin-1']);
  });

  it('cancels a Batch with no live Registrations, refunding nothing', async () => {
    const db = makeTripDb({ trips: [tripRow()], batches: [batchRow()] });

    const result = await cancelBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      now: NOW,
    });

    expect(db.batch().status).toBe('CANCELLED');
    expect(result.refunds).toEqual([]);
    expect(db.refunds).toEqual([]);
  });

  it('refuses a Batch that met its minimum quota with a 400, changing and refunding nothing', async () => {
    const db = underQuota(batchRow({ minQuota: 2 }));

    const error = await cancelBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchMinQuotaMetError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 400, body: { code: 'BATCH_MIN_QUOTA_MET' } });
    expect(db.batch().status).toBe('OPEN');
    expect(db.registrations.map((r) => r.status)).toEqual(['CONFIRMED', 'CONFIRMED', 'HOLD', 'EXPIRED']);
    expect(db.refunds).toEqual([]);
  });

  it('refuses someone who is neither the Fundraiser nor an Admin with a 403, changing nothing', async () => {
    const db = underQuota();

    const error = await cancelBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: stranger,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(db.batch().status).toBe('OPEN');
    expect(db.refunds).toEqual([]);
  });

  it.each(['CLOSED', 'CANCELLED', 'COMPLETED'] as const)('refuses a %s Batch with a 409, refunding nothing', async (status) => {
    const db = underQuota(batchRow({ status }));

    const error = await cancelBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchNotOpenError);
    expect(db.refunds).toEqual([]);
  });

  it('refuses a second cancel with a 409, so no Registration is refunded twice', async () => {
    const db = underQuota();
    await cancelBatch(db.prisma as never, { tripId: 'trip-1', batchId: 'batch-1', actor: fundraiser, now: NOW });

    const error = await cancelBatch(db.prisma as never, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      actor: fundraiser,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BatchNotOpenError);
    expect(db.refunds).toHaveLength(2);
  });

  it('refunds a Registration whose settlement committed before this cancel got its lock', async () => {
    const db = underQuota();
    db.beforeNextRowLock((data) => {
      data.registrations.find((r) => r.id === 'reg-hold')!.status = 'CONFIRMED';
      data.payments.push(paymentRow({ id: 'payment-c', registrationId: 'reg-hold', amount: 175_000 }));
    });

    await cancelBatch(db.prisma as never, { tripId: 'trip-1', batchId: 'batch-1', actor: fundraiser, now: NOW });

    expect(db.registrations.find((r) => r.id === 'reg-hold')!.status).toBe('CANCELLED');
    expect(db.refunds.map((r) => [r.paymentId, r.amount])).toEqual([
      ['payment-a', 100_000],
      ['payment-b', 250_000],
      ['payment-c', 175_000],
    ]);
  });
});
