import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    refund: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockRefundFindUnique = prisma.refund.findUnique as unknown as Mock;
const mockRefundFindUniqueOrThrow = prisma.refund.findUniqueOrThrow as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function makeTx(options: { refundRow?: Record<string, unknown> | null } = {}) {
  const state = options.refundRow ? { ...options.refundRow } : null;
  return {
    tx: {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      refund: {
        findUnique: vi.fn().mockResolvedValue(state),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
          if (!state || state.status !== where.status) return { count: 0 };
          Object.assign(state, data);
          return { count: 1 };
        }),
      },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    },
  };
}

function makeRefundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    paymentId: 'payment-1',
    amount: 40_000,
    status: 'REQUESTED',
    requestedById: 'requester-1',
    approvedById: null,
    payment: {
      amount: 100_000,
      providerFee: 5_000,
      escrowReleasedAt: null,
      donation: { campaignId: 'campaign-1' },
      registration: null,
    },
    ...overrides,
  };
}

function patchRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/refunds/refund-1/approve', { method: 'PATCH' });
}

function routeContext(id = 'refund-1') {
  return { params: Promise.resolve({ slug: 'test-campaign', id }) };
}

describe('PATCH /api/campaigns/[slug]/refunds/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-2', role: 'ADMIN', assignments: ['ADMIN'] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockRefundFindUnique.mockResolvedValue({ payment: { donation: { campaignId: 'campaign-1' } } });
    mockRefundFindUniqueOrThrow.mockResolvedValue(makeRefundRow({ status: 'APPROVED', approvedById: 'admin-2' }));
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it("returns 404 when the Refund's Payment belongs to a different Campaign than the URL slug", async () => {
    mockRefundFindUnique.mockResolvedValue({ payment: { donation: { campaignId: 'a-different-campaign' } } });
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the refund id does not exist at all', async () => {
    mockRefundFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('approves a REQUESTED refund and returns 200 with the updated status', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('APPROVED');
  });

  it('returns 403 when the approver is the same person who requested it', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'requester-1', role: 'ADMIN', assignments: ['ADMIN'] } });
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(403);
  });

  it("returns 403 OWN_CAMPAIGN_CONFLICT when the approving Admin is the Campaign's own Fundraiser, leaving the Refund REQUESTED", async () => {
    const refundRow = makeRefundRow();
    refundRow.payment.donation = { campaignId: 'campaign-1', campaign: { creatorId: 'admin-2' } } as never;
    const { tx } = makeTx({ refundRow });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT', error: expect.stringContaining('harus dilakukan Admin lain') });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('returns 409 when the refund is no longer REQUESTED', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow({ status: 'APPROVED' }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(409);
  });
});
