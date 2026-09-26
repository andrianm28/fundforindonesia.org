import { describe, it, expect } from 'vitest';
import {
  decideVerificationRequest,
  domainErrorToHttp,
  RequiredChecklistItemsUntickedError,
  LifecycleValidationError,
  OwnSubjectConflictError,
  VerificationRequestNotFoundError,
  VerificationRequestNotPendingError,
} from './campaign-lifecycle';
import {
  campaignRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

const NOW = new Date('2026-09-25T10:00:00Z');
const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };

const CHECKLIST = [
  { id: 'item-1', label: 'KTP penanggung jawab', required: true, position: 1, ticked: false },
  { id: 'item-2', label: 'Rencana anggaran', required: true, position: 2, ticked: false },
  { id: 'item-3', label: 'Foto kondisi', required: false, position: 3, ticked: false },
];
const ALL_REQUIRED_TICKED = ['item-1', 'item-2'];

function seeded(overrides: Parameters<typeof makeCampaignDb>[0] = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow()],
    verificationRequests: [verificationRequestRow({ id: 'verification-open', checklist: CHECKLIST })],
    ...overrides,
  });
}

describe('decideVerificationRequest', () => {
  it('approving makes the Submitted Campaign Active, and records the ticks, outcome, Verifier and time on the request', async () => {
    const db = seeded();

    const result = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'approve',
      ticked: ['item-1', 'item-2'],
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
    expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(db.verificationRequests).toEqual([
      expect.objectContaining({
        id: 'verification-open',
        outcome: 'APPROVED',
        reason: null,
        decidedById: 'verifier-1',
        decidedAt: NOW,
        checklist: [
          { id: 'item-1', label: 'KTP penanggung jawab', required: true, position: 1, ticked: true },
          { id: 'item-2', label: 'Rencana anggaran', required: true, position: 2, ticked: true },
          { id: 'item-3', label: 'Foto kondisi', required: false, position: 3, ticked: false },
        ],
      }),
    ]);
    expect(result.verificationRequest).toMatchObject({ id: 'verification-open', outcome: 'APPROVED' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
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

  it('rejecting with a reason makes the Campaign Rejected, keeps the reason on the request and in the status log', async () => {
    const db = seeded();

    const result = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'reject',
      ticked: ['item-1'],
      reason: '  Rencana anggaran belum dilampirkan.  ',
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('REJECTED');
    expect(db.verificationRequests[0]).toMatchObject({
      outcome: 'REJECTED',
      reason: 'Rencana anggaran belum dilampirkan.',
      decidedById: 'verifier-1',
      decidedAt: NOW,
    });
    expect((db.verificationRequests[0].checklist as { ticked: boolean }[]).map((e) => e.ticked)).toEqual([
      true,
      false,
      false,
    ]);
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'SUBMISSION_REJECTED',
        fromStatus: 'SUBMITTED',
        toStatus: 'REJECTED',
        capacity: 'VERIFIER',
        reason: 'Rencana anggaran belum dilampirkan.',
      }),
    ]);
  });

  describe('required checklist items', () => {
    it('refuses to loloskan with a required item unticked, naming it, and changes nothing (422)', async () => {
      const db = seeded();

      const error = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'approve',
        ticked: ['item-1', 'item-3'],
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RequiredChecklistItemsUntickedError);
      expect(domainErrorToHttp(error)).toEqual({
        status: 422,
        body: {
          error: 'Campaign belum dapat diloloskan. Butir wajib yang belum dicentang: Rencana anggaran.',
          code: 'REQUIRED_CHECKLIST_ITEMS_UNTICKED',
        },
      });
      expect(db.verificationRequests[0]).toMatchObject({ outcome: 'PENDING', decidedAt: null, checklist: CHECKLIST });
      expect(db.campaign().lifecycleStatus).toBe('SUBMITTED');
      expect(db.identityVerifications).toEqual([]);
      expect(db.statusChanges).toEqual([]);
      expect(db.notifications).toEqual([]);
    });

    it('names every unticked required item, in checklist order', async () => {
      const db = seeded();

      const error = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'approve',
        now: NOW,
      }).catch((e: unknown) => e);

      expect((error as Error).message).toBe(
        'Campaign belum dapat diloloskan. Butir wajib yang belum dicentang: KTP penanggung jawab, Rencana anggaran.'
      );
      expect((error as RequiredChecklistItemsUntickedError).labels).toEqual(['KTP penanggung jawab', 'Rencana anggaran']);
    });

    it('approves with every required item ticked and the optional one not', async () => {
      const db = seeded();

      const result = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'approve',
        ticked: ['item-2', 'item-1'],
        now: NOW,
      });

      expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
    });

    it.each([[[]], [['item-3']], [['item-1', 'item-2', 'item-3']]])('rejects whatever is ticked (%j)', async (ticked) => {
      const db = seeded();

      const result = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'reject',
        ticked,
        reason: 'Dokumen kurang.',
        now: NOW,
      });

      expect(result.campaign.lifecycleStatus).toBe('REJECTED');
    });
  });

  it.each([undefined, '', '   ', 42])('refuses a rejection whose reason is %j, changing nothing', async (reason) => {
    const db = seeded();

    const error = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'reject',
      reason,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(domainErrorToHttp(error)?.status).toBe(400);
    expect(db.verificationRequests[0]).toMatchObject({ outcome: 'PENDING', decidedAt: null });
    expect(db.campaign().lifecycleStatus).toBe('SUBMITTED');
  });

  it('tells the Fundraiser of a rejection with the reason, and of an approval', async () => {
    const rejected = seeded();
    await decideVerificationRequest(rejected.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'reject',
      reason: 'Foto KTP buram.',
      now: NOW,
    });
    const approved = seeded();
    await decideVerificationRequest(approved.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'approve',
      ticked: ALL_REQUIRED_TICKED,
      now: NOW,
    });

    expect(rejected.notifications).toEqual([
      expect.objectContaining({ userId: 'creator-1', title: 'Campaign Ditolak', link: '/campaign/bantu-korban-banjir' }),
    ]);
    expect(rejected.notifications[0].message).toContain('Foto KTP buram.');
    expect(rejected.notifications[0].message).toContain('Bantu Korban Banjir');
    expect(approved.notifications).toEqual([
      expect.objectContaining({ userId: 'creator-1', title: 'Campaign Diloloskan' }),
    ]);
  });

  describe.each(['APPROVED', 'REJECTED', 'WITHDRAWN'] as const)('a request already %s', (outcome) => {
    it.each(['approve', 'reject'] as const)('is never changed again by %s (409)', async (decision) => {
      const closed = verificationRequestRow({
        id: 'verification-closed',
        checklist: CHECKLIST,
        outcome,
        reason: outcome === 'REJECTED' ? 'Alasan lama.' : null,
        decidedById: outcome === 'WITHDRAWN' ? null : 'verifier-2',
        decidedAt: new Date('2026-09-24T09:00:00Z'),
      });
      const db = makeCampaignDb({ campaigns: [campaignRow()], verificationRequests: [closed] });

      const error = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-closed',
        actor: verifier,
        decision,
        ticked: ['item-1'],
        reason: 'Alasan baru.',
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(VerificationRequestNotPendingError);
      expect(domainErrorToHttp(error)).toEqual({
        status: 409,
        body: { error: (error as Error).message, code: 'VERIFICATION_REQUEST_NOT_PENDING' },
      });
      expect(db.verificationRequests).toEqual([closed]);
      expect(db.campaign().lifecycleStatus).toBe('SUBMITTED');
      expect(db.statusChanges).toEqual([]);
      expect(db.notifications).toEqual([]);
      expect(db.identityVerifications).toEqual([]);
    });
  });

  it("deciding a resubmission leaves the Campaign's earlier, decided request exactly as it was", async () => {
    const earlier = verificationRequestRow({
      id: 'verification-earlier',
      checklist: CHECKLIST,
      outcome: 'REJECTED',
      reason: 'Alasan lama.',
      decidedById: 'verifier-2',
      decidedAt: new Date('2026-09-20T09:00:00Z'),
    });
    const db = seeded({
      campaigns: [campaignRow()],
      verificationRequests: [
        earlier,
        verificationRequestRow({ id: 'verification-open', checklist: CHECKLIST, isFirst: false }),
      ],
    });

    await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'approve',
      ticked: ['item-1', 'item-2', 'item-3'],
      now: NOW,
    });

    expect(db.verificationRequests[0]).toEqual(earlier);
    expect(db.verificationRequests[1]).toMatchObject({ outcome: 'APPROVED' });
  });

  it.each([
    ['an unknown id', 'verification-missing', []],
    [
      "another Campaign's request",
      'verification-other',
      [verificationRequestRow({ id: 'verification-other', campaignId: 'campaign-2' })],
    ],
  ])('answers 404 for %s', async (_label, requestId, extra) => {
    const db = seeded({
      campaigns: [campaignRow()],
      verificationRequests: [verificationRequestRow({ id: 'verification-open', checklist: CHECKLIST }), ...extra],
    });

    const error = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId,
      actor: verifier,
      decision: 'approve',
      ticked: ALL_REQUIRED_TICKED,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerificationRequestNotFoundError);
    expect(domainErrorToHttp(error)?.status).toBe(404);
    expect(db.campaign().lifecycleStatus).toBe('SUBMITTED');
  });

  it.each([
    ['not an array', 'item-1'],
    ['not all strings', ['item-1', 2]],
    ['an item the snapshot does not hold', ['item-1', 'item-added-later']],
  ])('refuses ticks that are %s with 400 on the ticked field', async (_label, ticked) => {
    const db = seeded();

    const error = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'approve',
      ticked,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect((error as LifecycleValidationError).field).toBe('ticked');
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
  });

  it('refuses the Verifier who owns the Campaign with OWN_CAMPAIGN_CONFLICT (403)', async () => {
    const db = seeded();

    const error = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: { userId: 'creator-1', assignments: ['VERIFIER'] },
      decision: 'approve',
      ticked: ALL_REQUIRED_TICKED,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OwnSubjectConflictError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 403, body: { code: 'OWN_CAMPAIGN_CONFLICT' } });
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
  });

  describe('Identity Verification', () => {
    it("the Fundraiser's first approval records it with the Verifier, time and note", async () => {
      const db = seeded();

      const result = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'approve',
        ticked: ALL_REQUIRED_TICKED,
        identityNote: '  KTP dicocokkan lewat panggilan video.  ',
        now: NOW,
      });

      expect(result.identityVerificationRecorded).toBe(true);
      expect(db.identityVerifications).toEqual([
        {
          id: expect.any(String),
          userId: 'creator-1',
          verifierId: 'verifier-1',
          verifiedAt: NOW,
          note: 'KTP dicocokkan lewat panggilan video.',
        },
      ]);
    });

    it('the note is optional', async () => {
      const db = seeded();

      await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'approve',
        ticked: ALL_REQUIRED_TICKED,
        now: NOW,
      });

      expect(db.identityVerifications).toEqual([expect.objectContaining({ userId: 'creator-1', note: null })]);
    });

    it('a later approval leaves the existing one as it was and creates no other', async () => {
      const existing = {
        id: 'identity-old',
        userId: 'creator-1',
        verifierId: 'verifier-2',
        verifiedAt: new Date('2026-08-01T00:00:00Z'),
        note: 'Diperiksa lebih dulu.',
      };
      const db = seeded({
        campaigns: [campaignRow()],
        verificationRequests: [verificationRequestRow({ id: 'verification-open', checklist: CHECKLIST })],
        identityVerifications: [existing],
      });

      const result = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'approve',
        ticked: ALL_REQUIRED_TICKED,
        identityNote: 'Catatan baru.',
        now: NOW,
      });

      expect(result.identityVerificationRecorded).toBe(false);
      expect(db.identityVerifications).toEqual([existing]);
    });

    it('a rejection records none', async () => {
      const db = seeded();

      await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'reject',
        reason: 'Dokumen kurang.',
        now: NOW,
      });

      expect(db.identityVerifications).toEqual([]);
    });

    it('refuses a note over 1000 characters with 400', async () => {
      const db = seeded();

      const error = await decideVerificationRequest(db.prisma as never, {
        campaignId: 'campaign-1',
        requestId: 'verification-open',
        actor: verifier,
        decision: 'approve',
        ticked: ALL_REQUIRED_TICKED,
        identityNote: 'x'.repeat(1001),
        now: NOW,
      }).catch((e: unknown) => e);

      expect((error as LifecycleValidationError).field).toBe('identityNote');
      expect(db.identityVerifications).toEqual([]);
    });
  });

  it('a request another Verifier decided while this one waited for the lock is refused as no longer pending', async () => {
    const db = seeded();
    db.beforeNextRowLock((data) => {
      Object.assign(data.verificationRequests[0], { outcome: 'APPROVED', decidedById: 'verifier-2', decidedAt: NOW });
      Object.assign(data.campaigns[0], { lifecycleStatus: 'ACTIVE' });
    });

    const error = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-open',
      actor: verifier,
      decision: 'reject',
      reason: 'Terlambat.',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerificationRequestNotPendingError);
    expect(db.verificationRequests[0]).toMatchObject({ outcome: 'APPROVED', decidedById: 'verifier-2', reason: null });
  });
});
