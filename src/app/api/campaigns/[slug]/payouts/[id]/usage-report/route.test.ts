import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, PATCH } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payout: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPayoutFindUnique = prisma.payout.findUnique as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

const VALID_BODY = {
  narrative: 'Dana dipakai untuk sembako dan transportasi.',
  lineItems: [{ label: 'Sembako', amount: 300_000 }],
  beneficiaryCount: 20,
  photos: ['https://example.com/bukti.jpg'],
};

function createPostRequest(body: unknown = VALID_BODY): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/payouts/payout-1/usage-report', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPatchRequest(body: unknown = { reason: 'Foto tidak sesuai narasi.' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/payouts/payout-1/usage-report', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-campaign', id: 'payout-1' }) };
}

/**
 * A fake tx client backing submitUsageReport's/disputeUsageReport's own
 * transaction, so the route is exercised against the real service rather
 * than a mocked-out result.
 */
function makeSubmitTx(payout: Record<string, unknown> | null) {
  const usageReportCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'ur-1',
    createdAt: new Date('2026-09-28'),
    ...data,
  }));
  return {
    tx: {
      payout: { findUnique: vi.fn().mockResolvedValue(payout) },
      usageReport: { create: usageReportCreate },
    },
    usageReportCreate,
  };
}

describe('POST /api/campaigns/[slug]/payouts/[id]/usage-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-1' });
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'campaign-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createPostRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not this Campaign's own Fundraiser", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else' } });
    const response = await POST(createPostRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await POST(createPostRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 404 when the payout does not belong to this campaign', async () => {
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'a-different-campaign' });
    const response = await POST(createPostRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body without ever resolving the payout further', async () => {
    const response = await POST(createPostRequest({ ...VALID_BODY, photos: [] }), routeContext());
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('creates a Usage Report and answers 201 for a COMPLETED payout', async () => {
    const { tx, usageReportCreate } = makeSubmitTx({ id: 'payout-1', status: 'COMPLETED', amount: 300_000, usageReport: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createPostRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe('ur-1');
    expect(usageReportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payoutId: 'payout-1', submittedById: 'creator-1' }),
      }),
    );
  });

  it('answers the service refusal (409) for a Payout that is not yet COMPLETED', async () => {
    const { tx } = makeSubmitTx({ id: 'payout-1', status: 'DRAFT', amount: 300_000, usageReport: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createPostRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe('USAGE_REPORT_PAYOUT_NOT_COMPLETED');
  });

  it('answers 409 USAGE_REPORT_ALREADY_EXISTS for a Payout that already has one', async () => {
    const { tx } = makeSubmitTx({
      id: 'payout-1',
      status: 'COMPLETED',
      amount: 300_000,
      usageReport: { id: 'ur-existing' },
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createPostRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe('USAGE_REPORT_ALREADY_EXISTS');
  });

  it('answers 400 USAGE_REPORT_INVALID when the line items do not sum to the Payout amount', async () => {
    const { tx } = makeSubmitTx({ id: 'payout-1', status: 'COMPLETED', amount: 500_000, usageReport: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createPostRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('USAGE_REPORT_INVALID');
  });
});

function makeDisputeTx(report: Record<string, unknown> | null) {
  const usageReportUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...report, ...data }));
  return {
    tx: {
      usageReport: { findUnique: vi.fn().mockResolvedValue(report), update: usageReportUpdate },
      campaign: {
        findUnique: vi.fn().mockResolvedValue({
          creatorId: 'creator-1',
          isDemo: false,
          lifecycleStatus: 'ACTIVE',
          deadline: null,
          kind: 'DONATION',
          collectingEntityId: null,
        }),
      },
      volunteerTrip: { findUnique: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    },
    usageReportUpdate,
  };
}

describe('PATCH /api/campaigns/[slug]/payouts/[id]/usage-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'campaign-1', usageReport: { id: 'ur-1' } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(createPatchRequest(), routeContext());
    expect(response.status).toBe(401);
  });

  it('returns 403 for a caller without the ADMIN assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', assignments: ['VERIFIER'] } });
    const response = await PATCH(createPatchRequest(), routeContext());
    expect(response.status).toBe(403);
  });

  it('returns 404 when the payout has no Usage Report yet', async () => {
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'campaign-1', usageReport: null });
    const response = await PATCH(createPatchRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 400 on a blank reason', async () => {
    const response = await PATCH(createPatchRequest({ reason: '   ' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('marks the report disputed and answers 200 with the reason', async () => {
    const { tx } = makeDisputeTx({ id: 'ur-1', disputedAt: null, payout: { campaignId: 'campaign-1', volunteerTripId: null } });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(createPatchRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.disputedReason).toBe('Foto tidak sesuai narasi.');
    expect(data.disputedById).toBe('admin-1');
  });

  it('answers 409 for a report already disputed', async () => {
    const { tx } = makeDisputeTx({
      id: 'ur-1',
      disputedAt: new Date('2026-01-01'),
      payout: { campaignId: 'campaign-1', volunteerTripId: null },
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(createPatchRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe('USAGE_REPORT_ALREADY_DISPUTED');
  });

  it("answers 403 OWN_CAMPAIGN_CONFLICT when the disputing Admin is this Campaign's own Fundraiser", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', assignments: ['ADMIN'] } });
    const { tx } = makeDisputeTx({ id: 'ur-1', disputedAt: null, payout: { campaignId: 'campaign-1', volunteerTripId: null } });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(createPatchRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('OWN_CAMPAIGN_CONFLICT');
  });
});
