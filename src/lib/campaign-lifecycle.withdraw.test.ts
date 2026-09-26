import { describe, it, expect } from 'vitest';
import {
  decideVerificationRequest,
  domainErrorToHttp,
  VerificationRequestNotFoundError,
  VerificationRequestNotPendingError,
  withdrawVerificationRequest,
} from './campaign-lifecycle';
import {
  campaignRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

const NOW = new Date('2026-09-25T10:00:00Z');
const fundraiser = { userId: 'creator-1', assignments: [] };

function seeded(request: Parameters<typeof verificationRequestRow>[0] = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow()],
    verificationRequests: [verificationRequestRow({ id: 'verification-open', ...request })],
  });
}

describe('withdrawVerificationRequest', () => {
  it("withdrawing the Campaign's first request makes it a Draft again, marking the request withdrawn by the Fundraiser", async () => {
    const db = seeded({ isFirst: true });

    const result = await withdrawVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: fundraiser,
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('DRAFT');
    expect(db.campaign().lifecycleStatus).toBe('DRAFT');
    expect(db.verificationRequests).toEqual([
      expect.objectContaining({
        id: 'verification-open',
        outcome: 'WITHDRAWN',
        reason: null,
        decidedById: 'creator-1',
        decidedAt: NOW,
      }),
    ]);
    expect(result.verificationRequest).toMatchObject({ id: 'verification-open', outcome: 'WITHDRAWN' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'SUBMISSION_WITHDRAWN',
        fromStatus: 'SUBMITTED',
        toStatus: 'DRAFT',
        actorId: 'creator-1',
        capacity: 'FUNDRAISER',
        reason: null,
        createdAt: NOW,
      }),
    ]);
  });

  it('withdrawing a resubmission makes the Campaign Rejected again', async () => {
    const db = seeded({ isFirst: false });

    const result = await withdrawVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: fundraiser,
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('REJECTED');
    expect(db.verificationRequests[0].outcome).toBe('WITHDRAWN');
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUBMISSION_WITHDRAWN', fromStatus: 'SUBMITTED', toStatus: 'REJECTED' }),
    ]);
  });

  it('the owner acts as Fundraiser even while holding ADMIN and VERIFIER, and nobody is notified', async () => {
    const db = seeded();

    await withdrawVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: { userId: 'creator-1', assignments: ['ADMIN', 'VERIFIER'] },
      now: NOW,
    });

    expect(db.statusChanges[0].capacity).toBe('FUNDRAISER');
    expect(db.notifications).toEqual([]);
  });

  it.each(['APPROVED', 'REJECTED', 'WITHDRAWN'] as const)(
    'refuses a request already %s with 409, writing nothing',
    async (outcome) => {
      const closed = { outcome, decidedById: 'verifier-1', decidedAt: new Date('2026-09-24T12:00:00Z') };
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus: outcome === 'APPROVED' ? 'ACTIVE' : 'REJECTED' })],
        verificationRequests: [verificationRequestRow({ id: 'verification-closed', ...closed })],
      });

      const error = await withdrawVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-closed',
        actor: fundraiser,
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(VerificationRequestNotPendingError);
      expect(domainErrorToHttp(error)).toMatchObject({
        status: 409,
        body: { code: 'VERIFICATION_REQUEST_NOT_PENDING' },
      });
      expect(db.verificationRequests[0]).toMatchObject(closed);
      expect(db.statusChanges).toEqual([]);
    },
  );

  it.each([
    ['a stranger', { userId: 'stranger-1', assignments: [] }],
    ['a Verifier', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
    ['an Admin', { userId: 'admin-1', assignments: ['ADMIN' as const] }],
  ])("refuses %s, who is not the Campaign's Fundraiser, with 403", async (_who, actor) => {
    const db = seeded();

    const error = await withdrawVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(domainErrorToHttp(error)).toMatchObject({ status: 403, body: { code: 'NOT_AUTHORIZED' } });
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
    expect(db.campaign().lifecycleStatus).toBe('SUBMITTED');
  });

  it("refuses a request of another Campaign with 404", async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow(), campaignRow({ id: 'campaign-2', slug: 'lain' })],
      verificationRequests: [verificationRequestRow({ id: 'verification-other', campaignId: 'campaign-2' })],
    });

    const error = await withdrawVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-other',
      actor: fundraiser,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerificationRequestNotFoundError);
    expect(domainErrorToHttp(error)?.status).toBe(404);
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
  });

  describe('racing a Verifier on the same request', () => {
    it("a decision committed before the withdrawal's lock makes the withdrawal 409", async () => {
      const db = seeded();
      db.beforeNextRowLock((data) => {
        Object.assign(data.verificationRequests[0], { outcome: 'APPROVED', decidedById: 'verifier-1', decidedAt: NOW });
        Object.assign(data.campaigns[0], { lifecycleStatus: 'ACTIVE' });
      });

      const error = await withdrawVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: fundraiser,
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(VerificationRequestNotPendingError);
      expect(domainErrorToHttp(error)?.status).toBe(409);
      expect(db.verificationRequests[0]).toMatchObject({ outcome: 'APPROVED', decidedById: 'verifier-1' });
      expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
    });

    it("a withdrawal committed before the Verifier's lock makes the decision 409", async () => {
      const db = seeded();
      await withdrawVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: fundraiser,
        now: NOW,
      });

      const error = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: { userId: 'verifier-1', assignments: ['VERIFIER'] },
        decision: 'approve',
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(VerificationRequestNotPendingError);
      expect(domainErrorToHttp(error)).toMatchObject({
        status: 409,
        body: { error: 'Verification Request ini sudah ditarik oleh Fundraiser.' },
      });
      expect(db.verificationRequests[0]).toMatchObject({ outcome: 'WITHDRAWN', decidedById: 'creator-1' });
      expect(db.campaign().lifecycleStatus).toBe('DRAFT');
      expect(db.identityVerifications).toEqual([]);
    });
  });
});
