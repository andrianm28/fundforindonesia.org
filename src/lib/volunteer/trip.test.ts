import { describe, it, expect } from 'vitest';
import { decideTripSubmission, isTripSubmissionDecision, submitTrip } from './trip';
import {
  TripNotEditableError,
  TripNotFoundError,
  TripNotSubmittedError,
  TripRejectionReasonInvalidError,
} from '@/lib/volunteer-trip-errors';
import { NotAuthorizedError, OwnSubjectConflictError } from '@/lib/capacity';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { decideVerificationRequest } from '@/lib/campaign-lifecycle';
import { campaignRow, makeCampaignDb, userRow, verificationRequestRow } from '../../../tests/support/in-memory-campaign-db';
import { makeTripDb, tripRow } from '../../../tests/support/in-memory-trip-db';

const NOW = new Date('2026-09-26T10:00:00Z');
const fundraiser = { userId: 'fundraiser-1', assignments: [] };

describe('submitTrip', () => {
  it('submits a Draft Trip for review and records who submitted it as its Fundraiser', async () => {
    const db = makeTripDb({ trips: [tripRow()] });

    const result = await submitTrip(db.prisma as never, { tripId: 'trip-1', actor: fundraiser, now: NOW });

    expect(result.trip).toMatchObject({ id: 'trip-1', status: 'SUBMITTED' });
    expect(db.trip().status).toBe('SUBMITTED');
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        tripId: 'trip-1',
        action: 'SUBMITTED',
        fromStatus: 'DRAFT',
        toStatus: 'SUBMITTED',
        actorId: 'fundraiser-1',
        capacity: 'FUNDRAISER',
        reason: null,
        createdAt: NOW,
      }),
    ]);
  });

  it('resubmits a Rejected Trip, logged from REJECTED', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'REJECTED' })] });

    await submitTrip(db.prisma as never, { tripId: 'trip-1', actor: fundraiser, now: NOW });

    expect(db.trip().status).toBe('SUBMITTED');
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUBMITTED', fromStatus: 'REJECTED', toStatus: 'SUBMITTED' }),
    ]);
  });

  it.each(['SUBMITTED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED'] as const)(
    'refuses a Trip that is %s with a 409 TRIP_NOT_EDITABLE, writing nothing',
    async (status) => {
      const db = makeTripDb({ trips: [tripRow({ status, title: 'Asli' })] });

      const error = await submitTrip(db.prisma as never, {
        tripId: 'trip-1',
        actor: fundraiser,
        edits: { title: 'Diubah' },
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TripNotEditableError);
      expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'TRIP_NOT_EDITABLE' } });
      expect(db.trip()).toMatchObject({ status, title: 'Asli' });
      expect(db.statusChanges).toEqual([]);
    },
  );

  it('applies the edits sent with the submit in the same write', async () => {
    const db = makeTripDb({ trips: [tripRow()] });

    const result = await submitTrip(db.prisma as never, {
      tripId: 'trip-1',
      actor: fundraiser,
      edits: { title: 'Judul Baru', tripFeeAmount: 3_000_000 },
      now: NOW,
    });

    expect(result.trip).toMatchObject({ title: 'Judul Baru', tripFeeAmount: 3_000_000, status: 'SUBMITTED' });
    expect(db.trip()).toMatchObject({ title: 'Judul Baru', tripFeeAmount: 3_000_000, status: 'SUBMITTED' });
  });

  it.each([
    ['another user', { userId: 'someone-else', assignments: [] }],
    ['an Admin who does not own it', { userId: 'admin-1', assignments: ['ADMIN' as const] }],
    ['a Verifier who does not own it', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
  ])('refuses %s: only the Fundraiser submits their Trip', async (_who, actor) => {
    const db = makeTripDb({ trips: [tripRow()] });

    const error = await submitTrip(db.prisma as never, { tripId: 'trip-1', actor, now: NOW }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(domainErrorToHttp(error)).toEqual({
      status: 403,
      body: { error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.', code: 'NOT_AUTHORIZED' },
    });
    expect(db.trip().status).toBe('DRAFT');
    expect(db.statusChanges).toEqual([]);
  });

  it('refuses an unknown Trip with a 404 TRIP_NOT_FOUND', async () => {
    const db = makeTripDb({ trips: [] });

    const error = await submitTrip(db.prisma as never, { tripId: 'nope', actor: fundraiser, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TripNotFoundError);
    expect(domainErrorToHttp(error)?.status).toBe(404);
  });

  it('takes the Trip row lock before it reads the status', async () => {
    const db = makeTripDb({ trips: [tripRow()] });

    await submitTrip(db.prisma as never, { tripId: 'trip-1', actor: fundraiser, now: NOW });

    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1']);
  });

  it('judges a submit committed before our lock: the second submit is a 409 and logs nothing', async () => {
    const db = makeTripDb({ trips: [tripRow()] });
    db.beforeNextRowLock((data) => {
      data.trips[0].status = 'SUBMITTED';
    });

    const error = await submitTrip(db.prisma as never, { tripId: 'trip-1', actor: fundraiser, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TripNotEditableError);
    expect(domainErrorToHttp(error)?.status).toBe(409);
    expect(db.statusChanges).toEqual([]);
  });

  it('judges a Verifier approval committed before our lock: the submit cannot pull the Trip back', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });
    db.beforeNextRowLock((data) => {
      data.trips[0].status = 'ACTIVE';
    });

    const error = await submitTrip(db.prisma as never, { tripId: 'trip-1', actor: fundraiser, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TripNotEditableError);
    expect(db.trip().status).toBe('ACTIVE');
  });
});

const REASON = 'Dokumen kurang lengkap';
const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };

describe('decideTripSubmission', () => {
  describe('the rejection reason', () => {
    it('is stored trimmed on the status change, in the same write as the change', async () => {
      const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });

      await decideTripSubmission(db.prisma as never, {
        tripId: 'trip-1',
        actor: verifier,
        decision: 'reject',
        reason: '  Itinerary belum jelas  ',
        now: NOW,
      });

      expect(db.statusChanges).toEqual([expect.objectContaining({ toStatus: 'REJECTED', reason: 'Itinerary belum jelas' })]);
    });

    it.each([undefined, null, '', '   ', 42, 'x'.repeat(1001)])(
      'refuses a reject with the reason %j as a 422, changing and telling nothing',
      async (reason) => {
        const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });

        const error = await decideTripSubmission(db.prisma as never, {
          tripId: 'trip-1',
          actor: verifier,
          decision: 'reject',
          reason,
          now: NOW,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(TripRejectionReasonInvalidError);
        expect(domainErrorToHttp(error)).toMatchObject({ status: 422, body: { code: 'TRIP_REJECTION_REASON_INVALID' } });
        expect(db.trip().status).toBe('SUBMITTED');
        expect(db.statusChanges).toEqual([]);
        expect(db.notifications).toEqual([]);
      },
    );

    it('accepts a reason of exactly the bound', async () => {
      const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });
      await decideTripSubmission(db.prisma as never, {
        tripId: 'trip-1',
        actor: verifier,
        decision: 'reject',
        reason: 'x'.repeat(1000),
        now: NOW,
      });
      expect(db.trip().status).toBe('REJECTED');
    });

    it('is not needed for an approval, and one sent with it is not stored', async () => {
      const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });

      await decideTripSubmission(db.prisma as never, { tripId: 'trip-1', actor: verifier, decision: 'approve', now: NOW });
      expect(db.statusChanges[0].reason).toBeNull();

      const db2 = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });
      await decideTripSubmission(db2.prisma as never, {
        tripId: 'trip-1',
        actor: verifier,
        decision: 'approve',
        reason: 'ignored',
        now: NOW,
      });
      expect(db2.statusChanges[0].reason).toBeNull();
    });
  });

  it.each([
    ['approve', 'ACTIVE', 'SUBMISSION_APPROVED', 'Volunteer Trip Disetujui', 'Volunteer Trip Anda telah disetujui dan kini aktif'],
    ['reject', 'REJECTED', 'SUBMISSION_REJECTED', 'Volunteer Trip Ditolak', 'Volunteer Trip Anda ditolak'],
  ] as const)(
    '%s moves a Submitted Trip to %s, logs the Verifier decision and tells the Fundraiser',
    async (decision, to, action, title, message) => {
      const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });

      const result = await decideTripSubmission(db.prisma as never, {
        tripId: 'trip-1',
        actor: verifier,
        decision,
        reason: REASON,
        now: NOW,
      });

      expect(result.trip).toMatchObject({ id: 'trip-1', status: to });
      expect(db.trip().status).toBe(to);
      expect(db.statusChanges).toEqual([
        expect.objectContaining({
          tripId: 'trip-1',
          action,
          fromStatus: 'SUBMITTED',
          toStatus: to,
          actorId: 'verifier-1',
          capacity: 'VERIFIER',
          reason: decision === 'reject' ? REASON : null,
          createdAt: NOW,
        }),
      ]);
      expect(db.notifications).toEqual([
        expect.objectContaining({
          type: 'volunteer_trip_moderation',
          title,
          message,
          userId: 'fundraiser-1',
          link: '/volunteer-trip/mengajar-di-pulau-terpencil',
        }),
      ]);
    },
  );

  describe.each(['approve', 'reject'] as const)('%s outside Submitted', (decision) => {
    it.each(['DRAFT', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED'] as const)(
      'is refused from %s with a 409 TRIP_NOT_SUBMITTED, writing nothing',
      async (status) => {
        const db = makeTripDb({ trips: [tripRow({ status })] });

        const error = await decideTripSubmission(db.prisma as never, {
          tripId: 'trip-1',
          actor: verifier,
          decision,
          reason: REASON,
          now: NOW,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(TripNotSubmittedError);
        expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'TRIP_NOT_SUBMITTED' } });
        expect(db.trip().status).toBe(status);
        expect(db.statusChanges).toEqual([]);
        expect(db.notifications).toEqual([]);
      },
    );
  });

  it.each(['approve', 'reject'] as const)(
    'refuses the %s of a Verifier who owns the Trip with OWN_TRIP_CONFLICT',
    async (decision) => {
      const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED', fundraiserId: 'verifier-1' })] });

      const error = await decideTripSubmission(db.prisma as never, {
        tripId: 'trip-1',
        actor: verifier,
        decision,
        reason: REASON,
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OwnSubjectConflictError);
      expect(domainErrorToHttp(error)).toEqual({
        status: 403,
        body: {
          error:
            'Anda tidak dapat bertindak sebagai Verifier atas Volunteer Trip milik Anda sendiri. Tindakan ini harus dilakukan Verifier lain.',
          code: 'OWN_TRIP_CONFLICT',
        },
      });
      expect(db.trip().status).toBe('SUBMITTED');
      expect(db.statusChanges).toEqual([]);
      expect(db.notifications).toEqual([]);
    },
  );

  it('refuses someone without the VERIFIER assignment before it locks anything', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });

    const error = await decideTripSubmission(db.prisma as never, {
      tripId: 'trip-1',
      actor: { userId: 'admin-1', assignments: ['ADMIN'] },
      decision: 'approve',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(domainErrorToHttp(error)?.status).toBe(403);
    expect(db.rowLocks).toEqual([]);
  });

  it('refuses an unknown Trip with a 404 TRIP_NOT_FOUND', async () => {
    const db = makeTripDb({ trips: [] });

    const error = await decideTripSubmission(db.prisma as never, {
      tripId: 'nope',
      actor: verifier,
      decision: 'approve',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TripNotFoundError);
  });

  it('judges a decision committed before our lock: the second Verifier gets a 409 and nothing is written twice', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });
    db.beforeNextRowLock((data) => {
      data.trips[0].status = 'ACTIVE';
    });

    const error = await decideTripSubmission(db.prisma as never, {
      tripId: 'trip-1',
      actor: verifier,
      decision: 'reject',
      reason: REASON,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TripNotSubmittedError);
    expect(db.trip().status).toBe('ACTIVE');
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
    expect(db.rowLocks).toEqual(['VolunteerTrip:trip-1']);
  });

  it('knows its two decisions and nothing else', () => {
    expect(isTripSubmissionDecision('approve')).toBe(true);
    expect(isTripSubmissionDecision('reject')).toBe(true);
    expect(isTripSubmissionDecision('suspend')).toBe(false);
    expect(isTripSubmissionDecision('toString')).toBe(false);
    expect(isTripSubmissionDecision(undefined)).toBe(false);
  });
});

describe('decideTripSubmission: Identity Verification', () => {
  const approve = (db: ReturnType<typeof makeTripDb>, actor = verifier) =>
    decideTripSubmission(db.prisma as never, { tripId: 'trip-1', actor, decision: 'approve', now: NOW });

  it("approving a Fundraiser's first Trip records their Identity Verification, by this Verifier, now", async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });

    await approve(db);

    expect(db.identityVerifications).toEqual([
      { id: expect.any(String), userId: 'fundraiser-1', verifierId: 'verifier-1', verifiedAt: NOW, note: null },
    ]);
  });

  it('a rejection records none', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });

    await decideTripSubmission(db.prisma as never, {
      tripId: 'trip-1',
      actor: verifier,
      decision: 'reject',
      reason: 'Dokumen belum lengkap',
      now: NOW,
    });

    expect(db.identityVerifications).toEqual([]);
  });

  it('a refused approval records none', async () => {
    const db = makeTripDb({ trips: [tripRow({ status: 'ACTIVE' })] });

    await approve(db).catch(() => undefined);

    expect(db.identityVerifications).toEqual([]);
  });

  it('a Fundraiser already verified keeps the existing row and gets no other', async () => {
    const existing = {
      id: 'identity-old',
      userId: 'fundraiser-1',
      verifierId: 'verifier-2',
      verifiedAt: new Date('2026-08-01T00:00:00Z'),
      note: 'Diperiksa lebih dulu.',
    };
    const db = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })], identityVerifications: [existing] });

    await approve(db);

    expect(db.trip().status).toBe('ACTIVE');
    expect(db.identityVerifications).toEqual([existing]);
  });

  it('Trip then Campaign: the Campaign approval after a Trip approval creates no second row', async () => {
    const tripDb = makeTripDb({ trips: [tripRow({ status: 'SUBMITTED' })] });
    await approve(tripDb);
    const campaignDb = makeCampaignDb({
      campaigns: [campaignRow({ creatorId: 'fundraiser-1' })],
      users: [userRow({ id: 'fundraiser-1' })],
      verificationRequests: [verificationRequestRow({ id: 'verification-open', checklist: [] })],
      identityVerifications: tripDb.identityVerifications,
    });

    const result = await decideVerificationRequest(campaignDb.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: { userId: 'verifier-2', assignments: ['VERIFIER' as const] },
      decision: 'approve',
      ticked: [],
      now: new Date('2026-09-27T10:00:00Z'),
    });

    expect(result.identityVerificationRecorded).toBe(false);
    expect(campaignDb.identityVerifications).toEqual([
      { id: expect.any(String), userId: 'fundraiser-1', verifierId: 'verifier-1', verifiedAt: NOW, note: null },
    ]);
  });

  it('Campaign then Trip: the Trip approval after a Campaign approval creates no second row', async () => {
    const campaignDb = makeCampaignDb({
      campaigns: [campaignRow({ creatorId: 'fundraiser-1' })],
      users: [userRow({ id: 'fundraiser-1' })],
      verificationRequests: [verificationRequestRow({ id: 'verification-open', checklist: [] })],
    });
    await decideVerificationRequest(campaignDb.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'approve',
      ticked: [],
      identityNote: 'KTP cocok.',
      now: NOW,
    });
    expect(campaignDb.identityVerifications).toHaveLength(1);
    const tripDb = makeTripDb({
      trips: [tripRow({ status: 'SUBMITTED' })],
      identityVerifications: campaignDb.identityVerifications,
    });

    await approve(tripDb, { userId: 'verifier-2', assignments: ['VERIFIER' as const] });

    expect(tripDb.trip().status).toBe('ACTIVE');
    expect(tripDb.identityVerifications).toEqual([
      { id: expect.any(String), userId: 'fundraiser-1', verifierId: 'verifier-1', verifiedAt: NOW, note: 'KTP cocok.' },
    ]);
  });
});
