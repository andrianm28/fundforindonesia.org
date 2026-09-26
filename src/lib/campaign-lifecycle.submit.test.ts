import { describe, it, expect } from 'vitest';
import {
  CollectingEntityNotEligibleError,
  CollectingEntityRequiredError,
  DeadlineRequiredError,
  FundraisingPermitRequiredError,
  domainErrorToHttp,
  InvalidTransitionError,
  NotAuthorizedError,
  submitCampaign,
} from './campaign-lifecycle';
import {
  campaignRow,
  checklistItemRow,
  fundraisingPermitRow,
  makeCampaignDb,
  partnerOrganisationRow,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Submitting a Campaign to a Verifier (verification-request 01): a Draft or
 * Rejected Campaign becomes Submitted and gets a new PENDING Verification
 * Request holding a snapshot of the active checklist. Run against the
 * in-memory Prisma stand-in: assertions are about the rows left behind.
 */
const NOW = new Date('2026-09-26T10:00:00Z');
const DEADLINE = new Date('2026-12-31T00:00:00Z');
const fundraiser = { userId: 'creator-1', assignments: [] };

const CHECKLIST = [
  checklistItemRow({ id: 'identitas-fundraiser', label: 'KTP Fundraiser perorangan atau akta pendirian organisasi', position: 1 }),
  checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 2 }),
  checklistItemRow({ id: 'bukti-masalah', label: 'Bukti masalah', position: 3 }),
];

describe('submitCampaign', () => {
  it('moves a Draft to Submitted, opens one PENDING first request with the checklist snapshot, and logs it', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ deadline: DEADLINE, lifecycleStatus: 'DRAFT' })],
      checklistItems: CHECKLIST,
    });

    const result = await submitCampaign(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: fundraiser,
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('SUBMITTED');
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'SUBMITTED' });
    expect(db.verificationRequests).toEqual([
      {
        id: result.verificationRequest.id,
        campaignId: 'campaign-1',
        submittedById: 'creator-1',
        submittedAt: NOW,
        checklist: [
          { id: 'identitas-fundraiser', label: 'KTP Fundraiser perorangan atau akta pendirian organisasi', required: true, position: 1, ticked: false },
          { id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 2, ticked: false },
          { id: 'bukti-masalah', label: 'Bukti masalah', required: true, position: 3, ticked: false },
        ],
        outcome: 'PENDING',
        reason: null,
        decidedById: null,
        decidedAt: null,
        isFirst: true,
        collectingEntityId: 'partner-1',
      },
    ]);
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'SUBMITTED',
        fromStatus: 'DRAFT',
        toStatus: 'SUBMITTED',
        actorId: 'creator-1',
        capacity: 'FUNDRAISER',
        reason: null,
        createdAt: NOW,
      }),
    ]);
  });

  it('resubmits a Rejected Campaign as a new, non-first request, keeping the rejected one as it was', async () => {
    const rejected = verificationRequestRow({
      id: 'verification-old',
      outcome: 'REJECTED',
      reason: 'Rencana anggaran tidak dilampirkan.',
      decidedById: 'verifier-1',
      decidedAt: new Date('2026-09-25T08:00:00Z'),
    });
    const db = makeCampaignDb({
      campaigns: [campaignRow({ deadline: DEADLINE, lifecycleStatus: 'REJECTED' })],
      checklistItems: CHECKLIST,
      verificationRequests: [rejected],
    });

    const result = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: fundraiser, now: NOW });

    expect(result.campaign.lifecycleStatus).toBe('SUBMITTED');
    expect(db.verificationRequests).toHaveLength(2);
    expect(db.verificationRequests[0]).toEqual(rejected);
    expect(db.verificationRequests[1]).toMatchObject({ outcome: 'PENDING', isFirst: false, submittedAt: NOW });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUBMITTED', fromStatus: 'REJECTED', toStatus: 'SUBMITTED' }),
    ]);
  });

  it('snapshots only the active checklist items, in position order', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ deadline: DEADLINE, lifecycleStatus: 'DRAFT' })],
      checklistItems: [
        checklistItemRow({ id: 'second', label: 'Kedua', position: 2 }),
        checklistItemRow({ id: 'retired', label: 'Tidak dipakai lagi', position: 0, active: false }),
        checklistItemRow({ id: 'first', label: 'Pertama', position: 1, required: false }),
      ],
    });

    await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: fundraiser, now: NOW });

    expect(db.verificationRequests[0].checklist).toEqual([
      { id: 'first', label: 'Pertama', required: false, position: 1, ticked: false },
      { id: 'second', label: 'Kedua', required: true, position: 2, ticked: false },
    ]);
  });

  it.each(['SUBMITTED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED', 'EXPIRED'] as const)(
    'is refused from %s with a 409, writing nothing',
    async (lifecycleStatus) => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ deadline: DEADLINE, lifecycleStatus })],
        checklistItems: CHECKLIST,
      });

      const error = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: fundraiser, now: NOW }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect(domainErrorToHttp(error)?.status).toBe(409);
      expect(db.campaign().lifecycleStatus).toBe(lifecycleStatus);
      expect(db.verificationRequests).toEqual([]);
      expect(db.statusChanges).toEqual([]);
    },
  );

  it.each([
    ['a stranger', { userId: 'stranger-1', assignments: [] }],
    ['an Admin who is not its Fundraiser', { userId: 'admin-1', assignments: ['ADMIN' as const] }],
    ['a Verifier who is not its Fundraiser', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
  ])('refuses %s with 403 NOT_AUTHORIZED, writing nothing', async (_who, actor) => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ deadline: DEADLINE, lifecycleStatus: 'DRAFT' })],
      checklistItems: CHECKLIST,
    });

    const error = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 403, body: { code: 'NOT_AUTHORIZED' } });
    expect(db.campaign().lifecycleStatus).toBe('DRAFT');
    expect(db.verificationRequests).toEqual([]);
  });

  it('lets its Fundraiser submit while also holding ADMIN and VERIFIER, recorded as Fundraiser', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ deadline: DEADLINE, lifecycleStatus: 'DRAFT' })],
      checklistItems: CHECKLIST,
    });

    await submitCampaign(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: { userId: 'creator-1', assignments: ['ADMIN', 'VERIFIER'] },
      now: NOW,
    });

    expect(db.statusChanges).toEqual([expect.objectContaining({ capacity: 'FUNDRAISER' })]);
  });

  it('refuses a second submission committed before ours took the lock, so only one request is PENDING', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ deadline: DEADLINE, lifecycleStatus: 'DRAFT' })],
      checklistItems: CHECKLIST,
    });
    db.beforeNextRowLock((data) => {
      data.campaigns[0].lifecycleStatus = 'SUBMITTED';
      data.verificationRequests.push(verificationRequestRow({ id: 'verification-first' }));
    });

    const error = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: fundraiser, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect(db.verificationRequests.map((r) => r.id)).toEqual(['verification-first']);
  });

  describe('the deadline its Kind requires (CONTEXT.md, Campaign)', () => {
    it.each([
      ['DONATION', 'Donasi'],
      ['ZAKAT', 'Zakat'],
      ['HIBAH', 'Hibah'],
    ] as const)('refuses a %s Campaign without a deadline with a 422, writing nothing', async (kind, label) => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', kind, deadline: null })],
        checklistItems: CHECKLIST,
      });

      const error = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: fundraiser, now: NOW }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(DeadlineRequiredError);
      expect(domainErrorToHttp(error)).toEqual({
        status: 422,
        body: { code: 'DEADLINE_REQUIRED', error: `Tenggat wajib diisi untuk Campaign ber-Kind ${label}.` },
      });
      expect(db.campaign().lifecycleStatus).toBe('DRAFT');
      expect(db.verificationRequests).toEqual([]);
      expect(db.statusChanges).toEqual([]);
    });

    it('submits a wakaf Campaign that has no deadline', async () => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', kind: 'WAKAF', deadline: null })],
        checklistItems: CHECKLIST,
      });

      const result = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: fundraiser, now: NOW });

      expect(result.campaign.lifecycleStatus).toBe('SUBMITTED');
    });
  });

  describe('the Collecting Entity and its Fundraising Permit (prd-compliance 10, ADR 0010)', () => {
    async function refusal(db: ReturnType<typeof makeCampaignDb>) {
      return submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: fundraiser, now: NOW }).catch(
        (e: unknown) => e,
      );
    }

    function expectNothingWritten(db: ReturnType<typeof makeCampaignDb>) {
      expect(db.campaign().lifecycleStatus).toBe('DRAFT');
      expect(db.verificationRequests).toEqual([]);
      expect(db.statusChanges).toEqual([]);
    }

    it('refuses a Campaign that names no Collecting Entity with a 422', async () => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', deadline: DEADLINE, collectingEntityId: null })],
      });

      const error = await refusal(db);

      expect(error).toBeInstanceOf(CollectingEntityRequiredError);
      expect(domainErrorToHttp(error)).toMatchObject({ status: 422, body: { code: 'COLLECTING_ENTITY_REQUIRED' } });
      expectNothingWritten(db);
    });

    it.each([
      ['has lapsed', fundraisingPermitRow({ validTo: new Date('2026-09-26T09:00:00Z') })],
      ['is not valid yet', fundraisingPermitRow({ validFrom: new Date('2026-10-01T00:00:00Z') })],
      ['covers other Kinds only', fundraisingPermitRow({ kinds: ['ZAKAT', 'WAKAF'] })],
    ])('refuses when the Collecting Entity\'s only permit %s, with a 422 naming it and the Kind', async (_why, permit) => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', deadline: DEADLINE })],
        fundraisingPermits: [permit],
      });

      const error = await refusal(db);

      expect(error).toBeInstanceOf(FundraisingPermitRequiredError);
      expect(domainErrorToHttp(error)).toEqual({
        status: 422,
        body: {
          code: 'FUNDRAISING_PERMIT_REQUIRED',
          error:
            'Yayasan Contoh Peduli belum memegang Fundraising Permit yang berlaku untuk Kind Donasi, sehingga Campaign ini belum dapat diajukan.',
        },
      });
      expectNothingWritten(db);
    });

    it('refuses an individual Fundraiser\'s Campaign under an organisation that no longer accepts individual Campaigns', async () => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', deadline: DEADLINE })],
        partnerOrganisations: [partnerOrganisationRow({ acceptsIndividualCampaigns: false })],
      });

      const error = await refusal(db);

      expect(error).toBeInstanceOf(CollectingEntityNotEligibleError);
      expect(domainErrorToHttp(error)).toMatchObject({ status: 422, body: { code: 'COLLECTING_ENTITY_NOT_ELIGIBLE' } });
      expectNothingWritten(db);
    });

    it('lets the linked account submit under its own organisation, whether or not it accepts individual Campaigns', async () => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', deadline: DEADLINE, creatorId: 'partner-fundraiser-1' })],
        partnerOrganisations: [partnerOrganisationRow({ acceptsIndividualCampaigns: false })],
      });

      const result = await submitCampaign(db.prisma as never, {
        campaignId: 'campaign-1',
        actor: { userId: 'partner-fundraiser-1', assignments: [] },
        now: NOW,
      });

      expect(result.campaign.lifecycleStatus).toBe('SUBMITTED');
    });

    it('gives the linked account\'s Draft that names none its own organisation, and records it on the request', async () => {
      const db = makeCampaignDb({
        campaigns: [
          campaignRow({ lifecycleStatus: 'DRAFT', deadline: DEADLINE, creatorId: 'partner-fundraiser-1', collectingEntityId: null }),
        ],
      });

      await submitCampaign(db.prisma as never, {
        campaignId: 'campaign-1',
        actor: { userId: 'partner-fundraiser-1', assignments: [] },
        now: NOW,
      });

      expect(db.campaign().collectingEntityId).toBe('partner-1');
      expect(db.verificationRequests[0]).toMatchObject({ collectingEntityId: 'partner-1' });
    });

    it('refuses the linked account\'s Campaign under another organisation', async () => {
      const db = makeCampaignDb({
        campaigns: [
          campaignRow({ lifecycleStatus: 'DRAFT', deadline: DEADLINE, creatorId: 'partner-fundraiser-1', collectingEntityId: 'partner-2' }),
        ],
        partnerOrganisations: [
          partnerOrganisationRow(),
          partnerOrganisationRow({ id: 'partner-2', name: 'Yayasan Lain', fundraiserId: 'other-fundraiser' }),
        ],
        fundraisingPermits: [fundraisingPermitRow(), fundraisingPermitRow({ id: 'permit-2', partnerOrganisationId: 'partner-2' })],
      });

      const error = await submitCampaign(db.prisma as never, {
        campaignId: 'campaign-1',
        actor: { userId: 'partner-fundraiser-1', assignments: [] },
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CollectingEntityNotEligibleError);
    });
  });
});
