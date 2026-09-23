import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payment: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPaymentFindUnique = prisma.payment.findUnique as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

function makeTx(options: { ledgerRows?: LedgerRow[]; isDemo?: boolean; priorRefunds?: Array<{ amount: number; status: string }> } = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const refundCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'refund-1', createdAt: new Date(), ...data }));
  return {
    tx: {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'payment-1' }]),
      payment: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'payment-1',
          amount: 100_000,
          providerFee: 5_000,
          escrowReleasedAt: null,
          donation: { campaignId: 'campaign-1' },
          registration: null,
        }),
      },
      campaign: { findUnique: vi.fn().mockResolvedValue({ isDemo: options.isDemo ?? false }) },
      refund: { create: refundCreate, findMany: vi.fn().mockResolvedValue(options.priorRefunds ?? []) },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    },
    refundCreate,
    rows,
  };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/refunds', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-campaign' }) };
}

const VALID_BODY = { paymentId: 'payment-1', amount: 40_000, reason: 'Dibayar dua kali' };

describe('POST /api/campaigns/[slug]/refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockPaymentFindUnique.mockResolvedValue({ id: 'payment-1', donation: { campaignId: 'campaign-1' } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body without ever resolving the campaign', async () => {
    const response = await POST(postRequest({ paymentId: '', amount: -5, reason: '' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockCampaignFindUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
  });

  it("returns 404 when the Payment's Donation belongs to a different Campaign than the URL slug", async () => {
    mockPaymentFindUnique.mockResolvedValue({ id: 'payment-1', donation: { campaignId: 'a-different-campaign' } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the paymentId does not exist at all', async () => {
    mockPaymentFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('creates a REQUESTED Refund and returns 201 when everything checks out', async () => {
    const { tx, refundCreate } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-1', amount: 40_000, requestedById: 'admin-1' }) }),
    );
  });

  it('returns 403 for a demo Campaign, creating nothing', async () => {
    const { tx, refundCreate } = makeTx({ isDemo: true });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when the requested amount exceeds what is still refundable', async () => {
    const { tx, refundCreate } = makeTx({ priorRefunds: [{ amount: 90_000, status: 'REQUESTED' }] });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest({ ...VALID_BODY, amount: 20_000 }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/refund/i);
    expect(refundCreate).not.toHaveBeenCalled();
  });
});
