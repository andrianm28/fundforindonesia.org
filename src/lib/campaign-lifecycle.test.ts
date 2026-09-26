import { describe, it, expect } from 'vitest';
import {
  decideSubmission,
  effectiveStatus,
  expireIfPastDeadline,
  domainErrorToHttp,
  toLegacyStatus,
  toLifecycleStatus,
  CampaignNotFoundError,
  CancellationAlreadyPendingError,
  ConcurrentTransitionError,
  InvalidTransitionError,
  LifecycleValidationError,
  MissingCampaignUpdateError,
  NotAuthorizedError,
  OwnSubjectConflictError,
  PayoutAlreadyCompletedError,
  SameAdminLiftError,
} from './campaign-lifecycle';
import { campaignRow, makeCampaignDb } from '../../tests/support/in-memory-campaign-db';

const NOW = new Date('2026-09-25T10:00:00Z');
const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };

describe('decideSubmission', () => {
  it('approving a Submitted Campaign makes it Active in both columns and records who acted as Verifier', async () => {
    const db = makeCampaignDb({ campaigns: [campaignRow()] });

    const result = await decideSubmission(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: verifier,
      decision: 'approve',
      now: NOW,
    });

    expect(result.campaign).toMatchObject({ lifecycleStatus: 'ACTIVE', isUrgent: false });
    expect(db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        action: 'SUBMISSION_APPROVED',
        fromStatus: 'SUBMITTED',
        toStatus: 'ACTIVE',
        actorId: 'verifier-1',
        capacity: 'VERIFIER',
        reason: null,
        createdAt: NOW,
      }),
    ]);
  });

  it('rejecting a Submitted Campaign makes it Rejected in both columns, logged as a Verifier decision', async () => {
    const db = makeCampaignDb({ campaigns: [campaignRow()] });

    const result = await decideSubmission(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: verifier,
      decision: 'reject',
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('REJECTED');
    expect(db.campaign()).toMatchObject({ status: 'rejected', lifecycleStatus: 'REJECTED' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'SUBMISSION_REJECTED',
        fromStatus: 'SUBMITTED',
        toStatus: 'REJECTED',
        actorId: 'verifier-1',
        capacity: 'VERIFIER',
      }),
    ]);
  });

  it.each(['approve', 'reject'] as const)(
    'notifies the Fundraiser of the %s decision without calling anyone a moderator',
    async (decision) => {
      const db = makeCampaignDb({ campaigns: [campaignRow()] });

      await decideSubmission(db.prisma as never, { campaignId: 'campaign-1', actor: verifier, decision, now: NOW });

      expect(db.notifications).toHaveLength(1);
      const [notification] = db.notifications;
      expect(notification).toMatchObject({
        userId: 'creator-1',
        link: '/campaign/bantu-korban-banjir',
      });
      expect(notification.message).toContain('Bantu Korban Banjir');
      expect(`${notification.title} ${notification.message}`.toLowerCase()).not.toContain('moderator');
    },
  );

  describe.each(['approve', 'reject'] as const)('%s outside Submitted', (decision) => {
    it.each([
      ['DRAFT', 'pending'],
      ['ACTIVE', 'active'],
      ['REJECTED', 'rejected'],
      ['SUSPENDED', 'suspended'],
      ['COMPLETED', 'completed'],
      ['EXPIRED', 'expired'],
      ['CANCELLED', 'cancelled'],
    ] as const)(
      'is refused from %s with InvalidTransitionError, leaving the Campaign, log and inbox untouched',
      async (lifecycleStatus, status) => {
        const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, status })] });

        const error = await decideSubmission(db.prisma as never, {
          campaignId: 'campaign-1',
          actor: verifier,
          decision,
          now: NOW,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidTransitionError);
        expect((error as InvalidTransitionError).currentStatus).toBe(lifecycleStatus);
        expect(db.campaign()).toMatchObject({ lifecycleStatus, status });
        expect(db.statusChanges).toEqual([]);
        expect(db.notifications).toEqual([]);
      },
    );
  });
});

describe('legacy status string', () => {
  it.each([
    ['SUBMITTED', 'pending'],
    ['ACTIVE', 'active'],
    ['REJECTED', 'rejected'],
    ['SUSPENDED', 'suspended'],
    ['COMPLETED', 'completed'],
    ['EXPIRED', 'expired'],
    ['CANCELLED', 'cancelled'],
  ] as const)('maps %s to "%s" and back', (lifecycle, legacy) => {
    expect(toLegacyStatus(lifecycle)).toBe(legacy);
    expect(toLifecycleStatus(legacy)).toBe(lifecycle);
  });

  it('refuses to invent a legacy string for DRAFT, which the legacy column never had', () => {
    expect(() => toLegacyStatus('DRAFT')).toThrow();
  });
});

describe('domainErrorToHttp', () => {
  it.each([
    [new LifecycleValidationError('Alasan wajib diisi.', 'reason'), 400, 'VALIDATION'],
    [new NotAuthorizedError(), 403, 'NOT_AUTHORIZED'],
    [new OwnSubjectConflictError('campaign', 'ADMIN'), 403, 'OWN_CAMPAIGN_CONFLICT'],
    [new OwnSubjectConflictError('campaign', 'VERIFIER'), 403, 'OWN_CAMPAIGN_CONFLICT'],
    [new SameAdminLiftError(), 403, 'SAME_ADMIN_LIFT'],
    [new CampaignNotFoundError('campaign-1'), 404, 'CAMPAIGN_NOT_FOUND'],
    [new InvalidTransitionError('SUSPENDED'), 409, 'INVALID_TRANSITION'],
    [new ConcurrentTransitionError(), 409, 'CONCURRENT_TRANSITION'],
    [new PayoutAlreadyCompletedError(), 409, 'PAYOUT_ALREADY_COMPLETED'],
    [new CancellationAlreadyPendingError(), 409, 'CANCELLATION_ALREADY_PENDING'],
    [new MissingCampaignUpdateError(), 422, 'MISSING_CAMPAIGN_UPDATE'],
  ])('maps %s to HTTP %i with its Indonesian message', (error, status, code) => {
    expect(domainErrorToHttp(error)).toEqual({
      status,
      body: { error: error.message, code },
    });
  });

  it('names the status in plain words when a transition is refused', () => {
    expect(new InvalidTransitionError('SUSPENDED').message).toBe(
      'Tindakan ini tidak dapat dilakukan pada Campaign berstatus Suspended.',
    );
  });

  it('tells an Admin or Verifier on their own Campaign that another of the same role must act', () => {
    expect(new OwnSubjectConflictError('campaign', 'ADMIN').message).toContain('Admin lain');
    expect(new OwnSubjectConflictError('campaign', 'VERIFIER').message).toContain('Verifier lain');
  });

  it('tells the Admin another Admin must lift their Suspension', () => {
    expect(new SameAdminLiftError().message).toContain('Admin lain');
  });

  it('returns null for anything that is not a lifecycle refusal', () => {
    expect(domainErrorToHttp(new Error('database down'))).toBeNull();
    expect(domainErrorToHttp('boom')).toBeNull();
  });
});

describe('effectiveStatus', () => {
  const past = new Date('2026-09-24T10:00:00Z');
  const future = new Date('2026-09-26T10:00:00Z');

  it('counts an Active Campaign whose deadline has passed as Expired', () => {
    expect(effectiveStatus({ lifecycleStatus: 'ACTIVE', deadline: past }, NOW)).toBe('EXPIRED');
  });

  it('keeps an Active Campaign Active before its deadline, at its deadline, and without one', () => {
    expect(effectiveStatus({ lifecycleStatus: 'ACTIVE', deadline: future }, NOW)).toBe('ACTIVE');
    expect(effectiveStatus({ lifecycleStatus: 'ACTIVE', deadline: NOW }, NOW)).toBe('ACTIVE');
    expect(effectiveStatus({ lifecycleStatus: 'ACTIVE', deadline: null }, NOW)).toBe('ACTIVE');
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'SUSPENDED', 'CANCELLED', 'COMPLETED', 'EXPIRED'] as const)(
    'takes a stored %s as stored even past the deadline',
    (lifecycleStatus) => {
      expect(effectiveStatus({ lifecycleStatus, deadline: past }, NOW)).toBe(lifecycleStatus);
    },
  );
});

describe('lazy expiry', () => {
  const pastDeadline = new Date('2026-09-20T00:00:00Z');

  function activePastDeadline(overrides: Parameters<typeof campaignRow>[0] = {}) {
    return campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', deadline: pastDeadline, ...overrides });
  }

  it('tells the Fundraiser their Campaign has ended', async () => {
    const db = makeCampaignDb({ campaigns: [activePastDeadline()] });

    await expireIfPastDeadline(db.prisma as never, 'campaign-1', NOW);

    expect(db.notifications).toEqual([
      expect.objectContaining({ userId: 'creator-1', link: '/campaign/bantu-korban-banjir' }),
    ]);
    expect(db.notifications[0].message).toContain('Bantu Korban Banjir');
  });

  it('leaving Active clears Urgent in the same change and logs it with capacity SYSTEM', async () => {
    const db = makeCampaignDb({ campaigns: [activePastDeadline({ isUrgent: true })] });

    const expired = await expireIfPastDeadline(db.prisma as never, 'campaign-1', NOW);

    expect(expired).toBe(true);
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'EXPIRED', isUrgent: false });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'EXPIRED', capacity: 'SYSTEM', actorId: null, createdAt: NOW }),
      expect.objectContaining({
        action: 'URGENT_CLEARED',
        fromStatus: null,
        toStatus: null,
        actorId: null,
        capacity: 'SYSTEM',
        createdAt: NOW,
      }),
    ]);
  });

  it('logs no Urgent change when the Campaign was not Urgent', async () => {
    const db = makeCampaignDb({ campaigns: [activePastDeadline({ isUrgent: false })] });

    await expireIfPastDeadline(db.prisma as never, 'campaign-1', NOW);

    expect(db.statusChanges.map((s) => s.action)).toEqual(['EXPIRED']);
  });

  it.each([
    ['an Active Campaign before its deadline', campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', deadline: new Date('2026-10-01T00:00:00Z') })],
    ['an Active Campaign without a deadline', campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', deadline: null })],
    ['a Suspended Campaign past its deadline', campaignRow({ status: 'suspended', lifecycleStatus: 'SUSPENDED', deadline: pastDeadline })],
    ['an unknown Campaign', campaignRow({ id: 'another-campaign' })],
  ])('leaves %s alone', async (_label, row) => {
    const db = makeCampaignDb({ campaigns: [row] });

    const expired = await expireIfPastDeadline(db.prisma as never, 'campaign-1', NOW);

    expect(expired).toBe(false);
    expect(db.campaigns).toEqual([row]);
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
  });

  it('writes nothing when another request moved the Campaign first, and the command judges what that request left', async () => {
    const db = makeCampaignDb({ campaigns: [activePastDeadline()] });
    db.beforeNextCampaignWrite((data) => {
      Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
    });

    const error = await decideSubmission(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: verifier,
      decision: 'approve',
      now: NOW,
    }).catch((e: unknown) => e);

    expect((error as InvalidTransitionError).currentStatus).toBe('SUSPENDED');
    expect(db.campaign().lifecycleStatus).toBe('SUSPENDED');
    expect(db.statusChanges).toEqual([]);
  });
});
