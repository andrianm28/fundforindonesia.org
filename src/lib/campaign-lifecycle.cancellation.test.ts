import { describe, it, expect } from 'vitest';
import {
  requestCancellation,
  expireIfPastDeadline,
  decideCancellation,
  lifecycleErrorToHttp,
  CampaignNotFoundError,
  CancellationAlreadyPendingError,
  CancellationNotPendingError,
  CancellationRequestNotFoundError,
  ConcurrentTransitionError,
  InvalidTransitionError,
  LifecycleValidationError,
  NotAuthorizedError,
  OwnCampaignConflictError,
  PayoutAlreadyCompletedError,
} from './campaign-lifecycle';
import {
  campaignRow,
  cancellationRequestRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../tests/support/in-memory-campaign-db';

const NOW = new Date('2026-09-25T10:00:00Z');
const owner = { userId: 'creator-1', assignments: [] as const };

function activeCampaign(overrides: Partial<CampaignRow> = {}) {
  return campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', ...overrides });
}

describe('requestCancellation', () => {
  it('records a PENDING request from the owner and leaves the Campaign Active', async () => {
    const db = makeCampaignDb({ campaigns: [activeCampaign()] });

    const result = await requestCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: owner,
      reason: '  Pasien sudah sembuh.  ',
      now: NOW,
    });

    expect(result.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'ACTIVE',
      isUrgent: false,
    });
    expect(result.cancellationRequest).toMatchObject({
      campaignId: 'campaign-1',
      requestedById: 'creator-1',
      reason: 'Pasien sudah sembuh.',
      status: 'PENDING',
      decidedById: null,
    });
    expect(db.cancellationRequests).toEqual([expect.objectContaining({ status: 'PENDING' })]);
    expect(db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
  });

  it.each([
    ['a stranger', { userId: 'stranger-1', assignments: [] as const }],
    ['an Admin who does not own it', { userId: 'admin-1', assignments: ['ADMIN' as const] }],
    ['a Verifier who does not own it', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
  ])('refuses %s with NotAuthorizedError and records nothing', async (_label, actor) => {
    const db = makeCampaignDb({ campaigns: [activeCampaign()] });

    await expect(
      requestCancellation(db.prisma as never, { campaignId: 'campaign-1', actor, reason: 'Alasan.', now: NOW }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    expect(db.cancellationRequests).toEqual([]);
  });

  it('accepts an owner who also holds the ADMIN assignment: on their own Campaign they are its Fundraiser', async () => {
    const db = makeCampaignDb({ campaigns: [activeCampaign()] });

    const result = await requestCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: { userId: 'creator-1', assignments: ['ADMIN'] },
      reason: 'Alasan.',
      now: NOW,
    });

    expect(result.cancellationRequest.status).toBe('PENDING');
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['not text', 42],
    ['longer than 1000 characters', 'a'.repeat(1001)],
  ])('refuses a %s reason with LifecycleValidationError on the reason field', async (_label, reason) => {
    const db = makeCampaignDb({ campaigns: [activeCampaign()] });

    const error = await requestCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: owner,
      reason,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect((error as LifecycleValidationError).field).toBe('reason');
    expect(db.cancellationRequests).toEqual([]);
  });

  it('accepts a reason of exactly 1000 characters', async () => {
    const db = makeCampaignDb({ campaigns: [activeCampaign()] });

    const result = await requestCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: owner,
      reason: 'a'.repeat(1000),
      now: NOW,
    });

    expect(result.cancellationRequest.reason).toHaveLength(1000);
  });

  it('refuses an unknown Campaign with CampaignNotFoundError', async () => {
    const db = makeCampaignDb({ campaigns: [] });

    await expect(
      requestCancellation(db.prisma as never, { campaignId: 'missing', actor: owner, reason: 'Alasan.', now: NOW }),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
  });

  it.each([
    ['DRAFT', 'pending'],
    ['SUBMITTED', 'pending'],
    ['REJECTED', 'rejected'],
    ['SUSPENDED', 'suspended'],
    ['COMPLETED', 'completed'],
    ['EXPIRED', 'expired'],
    ['CANCELLED', 'cancelled'],
  ] as const)('refuses a Campaign stored %s with InvalidTransitionError', async (lifecycleStatus, status) => {
    const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, status })] });

    const error = await requestCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: owner,
      reason: 'Alasan.',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect((error as InvalidTransitionError).currentStatus).toBe(lifecycleStatus);
    expect(db.cancellationRequests).toEqual([]);
  });

  it('records Expired for an Active Campaign past its deadline, keeps it, and refuses the request', async () => {
    const db = makeCampaignDb({ campaigns: [activeCampaign({ deadline: new Date('2026-09-20T00:00:00Z') })] });

    const error = await requestCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: owner,
      reason: 'Alasan.',
      now: NOW,
    }).catch((e: unknown) => e);

    expect((error as InvalidTransitionError).currentStatus).toBe('EXPIRED');
    expect(db.campaign()).toMatchObject({ status: 'expired', lifecycleStatus: 'EXPIRED' });
    expect(db.statusChanges.map((s) => s.action)).toEqual(['EXPIRED']);
    expect(db.cancellationRequests).toEqual([]);
  });

  it('refuses a second request while one is PENDING, with CancellationAlreadyPendingError', async () => {
    const db = makeCampaignDb({
      campaigns: [activeCampaign()],
      cancellationRequests: [cancellationRequestRow()],
    });

    await expect(
      requestCancellation(db.prisma as never, { campaignId: 'campaign-1', actor: owner, reason: 'Lagi.', now: NOW }),
    ).rejects.toBeInstanceOf(CancellationAlreadyPendingError);

    expect(db.cancellationRequests).toHaveLength(1);
  });

  it.each(['REJECTED', 'SUPERSEDED'] as const)('accepts a new request after an earlier one was %s', async (status) => {
    const db = makeCampaignDb({
      campaigns: [activeCampaign()],
      cancellationRequests: [cancellationRequestRow({ status })],
    });

    await requestCancellation(db.prisma as never, { campaignId: 'campaign-1', actor: owner, reason: 'Lagi.', now: NOW });

    expect(db.cancellationRequests.map((r) => r.status)).toEqual([status, 'PENDING']);
  });

  it('ignores a PENDING request on another Campaign', async () => {
    const db = makeCampaignDb({
      campaigns: [activeCampaign()],
      cancellationRequests: [cancellationRequestRow({ campaignId: 'campaign-2' })],
    });

    await requestCancellation(db.prisma as never, { campaignId: 'campaign-1', actor: owner, reason: 'Alasan.', now: NOW });

    expect(db.cancellationRequests).toHaveLength(2);
  });

  it('holds the Campaign row lock while checking for a PENDING request, so two requests cannot both pass', async () => {
    const db = makeCampaignDb({ campaigns: [activeCampaign()] });

    await requestCancellation(db.prisma as never, { campaignId: 'campaign-1', actor: owner, reason: 'Alasan.', now: NOW });

    expect(db.rowLocks).toEqual(['Campaign:campaign-1']);
  });

  it('judges the Campaign as it stands once the lock is held: a Suspension committed meanwhile refuses the request', async () => {
    const db = makeCampaignDb({ campaigns: [activeCampaign()] });
    db.beforeNextRowLock((data) => {
      Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
    });

    const error = await requestCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: owner,
      reason: 'Alasan.',
      now: NOW,
    }).catch((e: unknown) => e);

    expect((error as InvalidTransitionError).currentStatus).toBe('SUSPENDED');
    expect(db.cancellationRequests).toEqual([]);
  });
});

describe('a PENDING request lapses when the Campaign leaves Active', () => {
  it('lazy expiry marks it SUPERSEDED in the same committed change', async () => {
    const db = makeCampaignDb({
      campaigns: [activeCampaign({ deadline: new Date('2026-09-20T00:00:00Z') })],
      cancellationRequests: [
        cancellationRequestRow(),
        cancellationRequestRow({ id: 'request-old', status: 'REJECTED', decidedById: 'admin-1' }),
      ],
    });

    await expireIfPastDeadline(db.prisma as never, 'campaign-1', NOW);

    expect(db.cancellationRequest()).toMatchObject({ status: 'SUPERSEDED', decidedById: null });
    expect(db.cancellationRequest().decidedAt).toBeInstanceOf(Date);
    expect(db.cancellationRequest('request-old')).toMatchObject({ status: 'REJECTED', decidedById: 'admin-1' });
  });

  it('leaves a PENDING request on another Campaign alone', async () => {
    const db = makeCampaignDb({
      campaigns: [activeCampaign({ deadline: new Date('2026-09-20T00:00:00Z') })],
      cancellationRequests: [cancellationRequestRow({ campaignId: 'campaign-2' })],
    });

    await expireIfPastDeadline(db.prisma as never, 'campaign-1', NOW);

    expect(db.cancellationRequest().status).toBe('PENDING');
  });
});

describe('Cancellation refusals over HTTP', () => {
  it.each([
    [new CancellationRequestNotFoundError('request-1'), 404, 'CANCELLATION_REQUEST_NOT_FOUND'],
    [new CancellationNotPendingError('APPROVED'), 409, 'CANCELLATION_NOT_PENDING'],
  ])('maps %s to HTTP %i', (error, status, code) => {
    expect(lifecycleErrorToHttp(error)).toEqual({ status, body: { error: error.message, code } });
  });

  it('tells the person a lapsed request must be made again rather than calling it decided', () => {
    expect(new CancellationNotPendingError('SUPERSEDED').message).toContain('gugur');
    expect(new CancellationNotPendingError('REJECTED').message).toContain('sudah diputuskan');
  });
});

describe('decideCancellation', () => {
  const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };

  function seeded(
    overrides: {
      campaign?: Partial<CampaignRow>;
      request?: Parameters<typeof cancellationRequestRow>[0];
      payouts?: { id: string; campaignId: string | null; status: string }[];
    } = {},
  ) {
    return makeCampaignDb({
      campaigns: [activeCampaign(overrides.campaign)],
      cancellationRequests: [cancellationRequestRow(overrides.request)],
      payouts: overrides.payouts ?? [],
    });
  }

  function decide(
    db: ReturnType<typeof makeCampaignDb>,
    params: Partial<Parameters<typeof decideCancellation>[1]> = {},
  ) {
    return decideCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'request-1',
      actor: admin,
      decision: 'approve',
      reason: 'Alasan penarikan dapat diterima.',
      now: NOW,
      ...params,
    });
  }

  describe('approve', () => {
    it('makes the Campaign Cancelled in both columns, marks the request APPROVED and logs it as an Admin decision', async () => {
      const db = seeded();

      const result = await decide(db, { reason: '  Dana belum dicairkan.  ' });

      expect(result.campaign).toEqual({
        id: 'campaign-1',
        slug: 'bantu-korban-banjir',
        lifecycleStatus: 'CANCELLED',
        isUrgent: false,
      });
      expect(result.cancellationRequest).toMatchObject({
        id: 'request-1',
        status: 'APPROVED',
        decidedById: 'admin-1',
        decisionReason: 'Dana belum dicairkan.',
        decidedAt: NOW,
      });
      expect(db.campaign()).toMatchObject({ status: 'cancelled', lifecycleStatus: 'CANCELLED' });
      expect(db.cancellationRequest()).toMatchObject({ status: 'APPROVED', decidedById: 'admin-1' });
      expect(db.statusChanges).toEqual([
        expect.objectContaining({
          campaignId: 'campaign-1',
          action: 'CANCELLED',
          fromStatus: 'ACTIVE',
          toStatus: 'CANCELLED',
          actorId: 'admin-1',
          capacity: 'ADMIN',
          reason: 'Dana belum dicairkan.',
        }),
      ]);
    });

    it('clears Urgent through the leave-Active hook, logged with capacity SYSTEM', async () => {
      const db = seeded({ campaign: { isUrgent: true } });

      const result = await decide(db);

      expect(result.campaign.isUrgent).toBe(false);
      expect(db.campaign().isUrgent).toBe(false);
      expect(db.statusChanges).toEqual([
        expect.objectContaining({ action: 'CANCELLED', capacity: 'ADMIN' }),
        expect.objectContaining({ action: 'URGENT_CLEARED', capacity: 'SYSTEM', actorId: null }),
      ]);
    });

    it('notifies the Fundraiser with the reason', async () => {
      const db = seeded();

      await decide(db, { reason: 'Dana belum dicairkan.' });

      expect(db.notifications).toEqual([
        expect.objectContaining({ userId: 'creator-1', type: 'campaign_status', link: '/campaign/bantu-korban-banjir' }),
      ]);
      expect(db.notifications[0].message).toContain('Bantu Korban Banjir');
      expect(db.notifications[0].message).toContain('Dana belum dicairkan.');
      expect(db.notifications[0].message).toContain('Cancelled');
    });

    it('takes the Campaign row lock before deciding', async () => {
      const db = seeded();

      await decide(db);

      expect(db.rowLocks).toEqual(['Campaign:campaign-1']);
    });

    it('is refused with PayoutAlreadyCompletedError once any Payout on the Campaign has Completed, changing nothing', async () => {
      const db = seeded({
        payouts: [
          { id: 'payout-1', campaignId: 'campaign-1', status: 'REJECTED' },
          { id: 'payout-2', campaignId: 'campaign-1', status: 'COMPLETED' },
        ],
      });

      await expect(decide(db)).rejects.toBeInstanceOf(PayoutAlreadyCompletedError);

      expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
      expect(db.cancellationRequest().status).toBe('PENDING');
      expect(db.statusChanges).toEqual([]);
      expect(db.notifications).toEqual([]);
    });

    it.each(['DRAFT', 'SUBMITTED', 'APPROVED', 'PROCESSING', 'FAILED', 'REJECTED'])(
      'is allowed while the only Payout is %s',
      async (status) => {
        const db = seeded({ payouts: [{ id: 'payout-1', campaignId: 'campaign-1', status }] });

        const result = await decide(db);

        expect(result.campaign.lifecycleStatus).toBe('CANCELLED');
      },
    );

    it('ignores a Completed Payout on another Campaign', async () => {
      const db = seeded({ payouts: [{ id: 'payout-1', campaignId: 'campaign-2', status: 'COMPLETED' }] });

      const result = await decide(db);

      expect(result.campaign.lifecycleStatus).toBe('CANCELLED');
    });

    it('records Expired for a Campaign past its deadline, lets the request lapse, and refuses with CancellationNotPendingError', async () => {
      const db = seeded({ campaign: { deadline: new Date('2026-09-20T00:00:00Z') } });

      await expect(decide(db)).rejects.toBeInstanceOf(CancellationNotPendingError);

      expect(db.campaign()).toMatchObject({ status: 'expired', lifecycleStatus: 'EXPIRED' });
      expect(db.cancellationRequest().status).toBe('SUPERSEDED');
      expect(db.statusChanges.map((s) => s.action)).toEqual(['EXPIRED']);
    });

    it.each([
      ['SUSPENDED', 'suspended'],
      ['COMPLETED', 'completed'],
      ['EXPIRED', 'expired'],
      ['CANCELLED', 'cancelled'],
    ] as const)(
      'is refused with InvalidTransitionError from %s even if a stray request is still PENDING',
      async (lifecycleStatus, status) => {
        const db = seeded({ campaign: { lifecycleStatus, status } });

        const error = await decide(db).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidTransitionError);
        expect((error as InvalidTransitionError).currentStatus).toBe(lifecycleStatus);
        expect(db.cancellationRequest().status).toBe('PENDING');
        expect(db.statusChanges).toEqual([]);
      },
    );

    it('loses to a concurrent status change with ConcurrentTransitionError, and the request stays PENDING', async () => {
      const db = seeded();
      db.beforeNextCampaignWrite((data) => {
        Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
      });

      await expect(decide(db)).rejects.toBeInstanceOf(ConcurrentTransitionError);

      expect(db.campaign().lifecycleStatus).toBe('SUSPENDED');
      expect(db.cancellationRequest().status).toBe('PENDING');
      expect(db.statusChanges).toEqual([]);
      expect(db.notifications).toEqual([]);
    });
  });

  describe('reject', () => {
    it('judges the Campaign as it stands once the lock is held: an approval committed meanwhile refuses the rejection', async () => {
      const db = seeded();
      db.beforeNextRowLock((data) => {
        Object.assign(data.campaigns[0], { status: 'cancelled', lifecycleStatus: 'CANCELLED' });
        Object.assign(data.cancellationRequests[0], { status: 'APPROVED', decidedById: 'admin-2' });
      });

      await expect(decide(db, { decision: 'reject' })).rejects.toBeInstanceOf(CancellationNotPendingError);

      expect(db.cancellationRequest()).toMatchObject({ status: 'APPROVED', decidedById: 'admin-2' });
      expect(db.notifications).toEqual([]);
    });

    it('marks the request REJECTED with the reason and leaves the Campaign Active, logging no status change', async () => {
      const db = seeded({ campaign: { isUrgent: true } });

      const result = await decide(db, { decision: 'reject', reason: '  Masih ada Donor aktif.  ' });

      expect(result.campaign).toEqual({
        id: 'campaign-1',
        slug: 'bantu-korban-banjir',
        lifecycleStatus: 'ACTIVE',
        isUrgent: true,
      });
      expect(result.cancellationRequest).toMatchObject({
        status: 'REJECTED',
        decidedById: 'admin-1',
        decisionReason: 'Masih ada Donor aktif.',
        decidedAt: NOW,
      });
      expect(db.cancellationRequest().status).toBe('REJECTED');
      expect(db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
      expect(db.statusChanges).toEqual([]);
    });

    it('notifies the Fundraiser with the reason', async () => {
      const db = seeded();

      await decide(db, { decision: 'reject', reason: 'Masih ada Donor aktif.' });

      expect(db.notifications).toEqual([expect.objectContaining({ userId: 'creator-1', type: 'campaign_status' })]);
      expect(db.notifications[0].message).toContain('Masih ada Donor aktif.');
      expect(db.notifications[0].message).toContain('Bantu Korban Banjir');
    });

    it('is allowed even when a Payout has Completed', async () => {
      const db = seeded({ payouts: [{ id: 'payout-1', campaignId: 'campaign-1', status: 'COMPLETED' }] });

      const result = await decide(db, { decision: 'reject' });

      expect(result.cancellationRequest.status).toBe('REJECTED');
    });
  });

  describe.each(['approve', 'reject'] as const)('%s, refused', (decision) => {
    it.each([
      ['a Verifier', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
      ['a person with no assignment', { userId: 'someone-1', assignments: [] as const }],
    ])('refuses %s with NotAuthorizedError', async (_label, actor) => {
      const db = seeded();

      await expect(decide(db, { decision, actor })).rejects.toBeInstanceOf(NotAuthorizedError);

      expect(db.cancellationRequest().status).toBe('PENDING');
    });

    it('refuses the owner even when they hold the ADMIN assignment, with OwnCampaignConflictError', async () => {
      const db = seeded();

      await expect(
        decide(db, { decision, actor: { userId: 'creator-1', assignments: ['ADMIN'] } }),
      ).rejects.toBeInstanceOf(OwnCampaignConflictError);

      expect(db.cancellationRequest().status).toBe('PENDING');
      expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
    });

    it.each([
      ['missing', undefined],
      ['blank', ' '],
      ['longer than 1000 characters', 'a'.repeat(1001)],
    ])('refuses a %s reason with LifecycleValidationError', async (_label, reason) => {
      const db = seeded();

      const error = await decide(db, { decision, reason }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LifecycleValidationError);
      expect((error as LifecycleValidationError).field).toBe('reason');
      expect(db.cancellationRequest().status).toBe('PENDING');
    });

    it('refuses an unknown Campaign with CampaignNotFoundError', async () => {
      const db = seeded();

      await expect(decide(db, { decision, campaignId: 'missing' })).rejects.toBeInstanceOf(CampaignNotFoundError);
    });

    it('refuses an unknown request with CancellationRequestNotFoundError', async () => {
      const db = seeded();

      await expect(decide(db, { decision, requestId: 'missing' })).rejects.toBeInstanceOf(
        CancellationRequestNotFoundError,
      );
    });

    it('refuses a request that belongs to another Campaign with CancellationRequestNotFoundError', async () => {
      const db = makeCampaignDb({
        campaigns: [activeCampaign(), activeCampaign({ id: 'campaign-2', slug: 'lain', creatorId: 'creator-2' })],
        cancellationRequests: [cancellationRequestRow({ campaignId: 'campaign-2' })],
      });

      await expect(decide(db, { decision })).rejects.toBeInstanceOf(CancellationRequestNotFoundError);

      expect(db.cancellationRequest().status).toBe('PENDING');
    });

    it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)(
      'refuses a request that is already %s with CancellationNotPendingError',
      async (status) => {
        const db = seeded({ request: { status } });

        await expect(decide(db, { decision })).rejects.toBeInstanceOf(CancellationNotPendingError);

        expect(db.cancellationRequest().status).toBe(status);
        expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
        expect(db.notifications).toEqual([]);
      },
    );
  });
});
