import { describe, it, expect } from 'vitest';
import {
  completeCampaign,
  requestCancellation,
  suspendCampaign,
  liftSuspension,
  expireIfPastDeadline,
  decideCancellation,
  domainErrorToHttp,
  CancellationAlreadyPendingError,
  CancellationNotPendingError,
  CancellationRequestNotFoundError,
  InvalidTransitionError,
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
  return campaignRow({ lifecycleStatus: 'ACTIVE', ...overrides });
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
      createdAt: NOW,
    });
    expect(db.cancellationRequests).toEqual([expect.objectContaining({ status: 'PENDING' })]);
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'ACTIVE' });
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
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

  it.each([
    ['DRAFT'],
    ['SUBMITTED'],
    ['REJECTED'],
    ['SUSPENDED'],
    ['COMPLETED'],
    ['EXPIRED'],
    ['CANCELLED'],
  ] as const)('refuses a Campaign stored %s with InvalidTransitionError', async (lifecycleStatus) => {
    const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus })] });

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
    expect(db.cancellationRequest().decidedAt).toEqual(NOW);
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

describe('a PENDING request lapses on the Completed and Suspended exits too', () => {
  const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };
  const otherAdmin = { userId: 'admin-2', assignments: ['ADMIN' as const] };
  type Db = ReturnType<typeof makeCampaignDb>;

  function withPendingRequest(campaign: Partial<CampaignRow> = {}) {
    return makeCampaignDb({
      campaigns: [activeCampaign(campaign)],
      cancellationRequests: [cancellationRequestRow()],
      campaignUpdates: [{ id: 'update-1', campaignId: 'campaign-1' }],
    });
  }

  function complete(db: Db, actor: typeof owner | typeof admin = owner, reason?: string) {
    return completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor, reason, now: NOW });
  }

  function suspend(db: Db) {
    return suspendCampaign(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: admin,
      reason: 'Laporan penipuan terverifikasi.',
      now: NOW,
    });
  }

  function lift(db: Db) {
    return liftSuspension(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: otherAdmin,
      reason: 'Klarifikasi diterima.',
      now: NOW,
    });
  }

  function decide(db: Db, decision: 'approve' | 'reject') {
    return decideCancellation(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'request-1',
      actor: otherAdmin,
      decision,
      reason: 'Diputuskan terlambat.',
      now: NOW,
    }).catch((e: unknown) => e);
  }

  /**
   * Makes every Notification write inside a transaction fail, so a command
   * that tells the Fundraiser dies after its status write and leave-Active
   * side effects: whatever the hook did must roll back with it.
   */
  function failNotificationWrites(db: Db) {
    const original = db.prisma.$transaction;
    db.prisma.$transaction = (async (callback: (tx: unknown) => Promise<unknown>) =>
      original((tx) =>
        callback({
          ...(tx as object),
          notification: {
            create: async () => {
              throw new Error('notification write failed');
            },
          },
        }),
      )) as typeof original;
  }

  const exits = {
    'Completed by an Admin': (db: Db) => complete(db, admin, 'Program selesai.'),
    Suspended: suspend,
  };

  describe('Completed', () => {
    it.each([
      ['the owner, as FUNDRAISER', owner, undefined, 'FUNDRAISER'],
      ['an Admin, as ADMIN', admin, 'Program selesai.', 'ADMIN'],
    ] as const)('marked by %s supersedes the request alongside the status change', async (_label, actor, reason, capacity) => {
      const db = withPendingRequest();

      await complete(db, actor, reason);

      expect(db.campaign().lifecycleStatus).toBe('COMPLETED');
      expect(db.statusChanges).toEqual([expect.objectContaining({ action: 'COMPLETED', capacity })]);
      expect(db.cancellationRequest()).toMatchObject({ status: 'SUPERSEDED', decidedById: null, decisionReason: null });
      expect(db.cancellationRequest().decidedAt).toEqual(NOW);
    });
  });

  describe('Suspended', () => {
    it('from Active supersedes the request alongside the status change', async () => {
      const db = withPendingRequest();

      await suspend(db);

      expect(db.campaign().lifecycleStatus).toBe('SUSPENDED');
      expect(db.statusChanges).toEqual([expect.objectContaining({ action: 'SUSPENDED', fromStatus: 'ACTIVE' })]);
      expect(db.cancellationRequest()).toMatchObject({ status: 'SUPERSEDED', decidedById: null, decisionReason: null });
      expect(db.cancellationRequest().decidedAt).toEqual(NOW);
    });

    it.each([
      ['EXPIRED'],
      ['COMPLETED'],
    ] as const)('from %s finds no PENDING request, leaves the lapsed one as it was and creates none', async (lifecycleStatus) => {
      const lapsedAt = new Date('2026-09-01T00:00:00Z');
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus })],
        cancellationRequests: [cancellationRequestRow({ status: 'SUPERSEDED', decidedAt: lapsedAt })],
      });

      await suspend(db);

      expect(db.campaign().lifecycleStatus).toBe('SUSPENDED');
      expect(db.cancellationRequests).toEqual([
        expect.objectContaining({ id: 'request-1', status: 'SUPERSEDED', decidedAt: lapsedAt }),
      ]);
    });
  });

  describe.each(Object.entries(exits))('in the same transaction as %s', (_exit, leave) => {
    it('leaves the request PENDING when the command fails after the status write', async () => {
      const db = withPendingRequest();
      failNotificationWrites(db);

      await expect(leave(db)).rejects.toThrow('notification write failed');

      expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
      expect(db.statusChanges).toEqual([]);
      expect(db.cancellationRequest().status).toBe('PENDING');
    });
  });

  describe('once lapsed', () => {
    it.each([
      ['Completed', 'approve', 'COMPLETED'],
      ['Completed', 'reject', 'COMPLETED'],
      ['Suspended', 'approve', 'SUSPENDED'],
      ['Suspended', 'reject', 'SUSPENDED'],
    ] as const)('after %s, %s answers 409 "sudah gugur" and changes nothing', async (exit, decision, lifecycleStatus) => {
      const db = withPendingRequest();
      await (exit === 'Completed' ? complete(db) : suspend(db));

      const error = await decide(db, decision);

      expect(error).toBeInstanceOf(CancellationNotPendingError);
      expect(domainErrorToHttp(error)).toEqual({
        status: 409,
        body: { error: expect.stringContaining('sudah gugur'), code: 'CANCELLATION_NOT_PENDING' },
      });
      expect(db.cancellationRequest()).toMatchObject({ status: 'SUPERSEDED', decidedById: null });
      expect(db.campaign().lifecycleStatus).toBe(lifecycleStatus);
    });

    it('stays lapsed when the Suspension is lifted and the Campaign is Active again', async () => {
      const db = withPendingRequest();
      await suspend(db);

      await lift(db);

      expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
      expect(db.cancellationRequests).toEqual([expect.objectContaining({ id: 'request-1', status: 'SUPERSEDED' })]);
      expect(await decide(db, 'approve')).toBeInstanceOf(CancellationNotPendingError);
      expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
    });

    it('must be filed again after the lift, as a new request', async () => {
      const db = withPendingRequest();
      await suspend(db);
      await lift(db);

      await requestCancellation(db.prisma as never, { campaignId: 'campaign-1', actor: owner, reason: 'Ajukan ulang.', now: NOW });

      expect(db.cancellationRequests.map((r) => r.status)).toEqual(['SUPERSEDED', 'PENDING']);
    });
  });
});

describe('Cancellation refusals over HTTP', () => {
  it.each([
    [new CancellationRequestNotFoundError('request-1'), 404, 'CANCELLATION_REQUEST_NOT_FOUND'],
    [new CancellationNotPendingError('APPROVED'), 409, 'CANCELLATION_NOT_PENDING'],
  ])('maps %s to HTTP %i', (error, status, code) => {
    expect(domainErrorToHttp(error)).toEqual({ status, body: { error: error.message, code } });
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
      expect(db.campaign()).toMatchObject({ lifecycleStatus: 'CANCELLED' });
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

    it.each([
      ['SUSPENDED'],
      ['COMPLETED'],
      ['EXPIRED'],
      ['CANCELLED'],
    ] as const)(
      'is refused with InvalidTransitionError from %s even if a stray request is still PENDING',
      async (lifecycleStatus) => {
        const db = seeded({ campaign: { lifecycleStatus } });

        const error = await decide(db).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidTransitionError);
        expect((error as InvalidTransitionError).currentStatus).toBe(lifecycleStatus);
        expect(db.cancellationRequest().status).toBe('PENDING');
        expect(db.statusChanges).toEqual([]);
      },
    );
  });

  describe('reject', () => {
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
      expect(db.campaign()).toMatchObject({ lifecycleStatus: 'ACTIVE' });
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
