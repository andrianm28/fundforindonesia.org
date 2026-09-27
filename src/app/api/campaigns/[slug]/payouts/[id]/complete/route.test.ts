import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma wholesale, matching the approve route's test. The fake tx
// below runs the real ledger (groupBy/count/createMany), so postTransaction
// and its balance guard are exercised for real: assertions below check the
// rows actually handed to ledgerEntry.createMany, not merely that some
// function was called.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payout: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPayoutFindUnique = prisma.payout.findUnique as unknown as Mock;
const mockPayoutFindUniqueOrThrow = prisma.payout.findUniqueOrThrow as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

const ACTIVE_CAMPAIGN = { creatorId: 'creator-1', isDemo: false, lifecycleStatus: 'ACTIVE', deadline: null };

function makeApprovedPayout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    campaignId: 'campaign-1',
    volunteerTripId: null,
    amount: 100_000,
    description: 'Pencairan dana',
    status: 'APPROVED',
    requestedById: 'creator-1',
    approvedById: 'admin-1',
    approvedAt: new Date('2026-02-01'),
    completedById: null,
    completedAt: null,
    proofImage: null,
    providerRef: null,
    ...overrides,
  };
}

/** The legs approval already posted: the money is in PAYOUT_CLEARING. */
const INSTRUCTED_ROWS: LedgerRow[] = [
  { transactionId: 'payout-instructed-payout-1', direction: 'DEBIT', amount: 100_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
  { transactionId: 'payout-instructed-payout-1', direction: 'CREDIT', amount: 100_000, account: 'PAYOUT_CLEARING', campaignId: null, volunteerTripId: null },
];

function makeTx(options: {
  payout: ReturnType<typeof makeApprovedPayout> | null;
  ledgerRows?: LedgerRow[];
  lifecycleStatus?: string;
}) {
  const { payout, ledgerRows = [], lifecycleStatus = 'ACTIVE' } = options;
  const rows: LedgerRow[] = [...ledgerRows];
  const state = payout ? { ...payout } : null;

  const findUnique = vi.fn().mockResolvedValue(state);
  const updateMany = vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
    if (!state || state.status !== where.status) return { count: 0 };
    Object.assign(state, data);
    return { count: 1 };
  });
  const queryRaw = vi.fn().mockResolvedValue([{ id: 'campaign-1' }]);

  return {
    tx: {
      payout: { findUnique, updateMany },
      $queryRaw: queryRaw,
      campaign: { findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_CAMPAIGN, lifecycleStatus }) },
      volunteerTrip: { findUnique: vi.fn().mockResolvedValue({ fundraiserId: 'creator-1', status: 'ACTIVE' }) },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(async () => []),
      },
    },
    state,
    rows,
    queryRaw,
  };
}

function createRequest(body: unknown = { proofImage: 'https://files.example/transfer.png' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/payouts/payout-1/complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function routeContext(id = 'payout-1') {
  return { params: Promise.resolve({ slug: 'test-campaign', id }) };
}

describe('POST /api/campaigns/[slug]/payouts/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The second Admin: the approver of this Payout is admin-1.
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'campaign-1' });
    mockPayoutFindUniqueOrThrow.mockResolvedValue(
      makeApprovedPayout({
        status: 'COMPLETED',
        completedById: 'admin-2',
        completedAt: new Date('2026-03-01'),
        proofImage: 'https://files.example/transfer.png',
      }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', assignments: ['VERIFIER'] } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the payout does not belong to this campaign', async () => {
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'a-different-campaign' });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the payout is Trip-linked -- a Trip payout can never be completed through the Campaign route', async () => {
    mockPayoutFindUnique.mockResolvedValue({ campaignId: null });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when the body carries no proof of transfer', async () => {
    const response = await POST(createRequest({ proofImage: '' }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.fieldErrors.proofImage).toBeTruthy();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('completes the payout with the proof attached, and drains PAYOUT_CLEARING', async () => {
    const { tx, state, rows } = makeTx({ payout: makeApprovedPayout(), ledgerRows: INSTRUCTED_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      id: 'payout-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      status: 'COMPLETED',
      approvedById: 'admin-1',
      completedById: 'admin-2',
      proofImage: 'https://files.example/transfer.png',
    });
    expect(state).toMatchObject({ status: 'COMPLETED', completedById: 'admin-2', proofImage: 'https://files.example/transfer.png' });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([
      expect.objectContaining({ account: 'PAYOUT_CLEARING', direction: 'DEBIT', amount: 100_000 }),
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 100_000 }),
    ]);
    expect(tx.payout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'payout-1', status: 'APPROVED' } }),
    );
  });

  it('takes the Campaign row lock, the same lock Cancellation approval holds', async () => {
    const { tx, queryRaw } = makeTx({ payout: makeApprovedPayout(), ledgerRows: INSTRUCTED_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    const lockedSql = queryRaw.mock.calls[0][0].join('');
    expect(lockedSql).toContain('FOR UPDATE');
    expect(lockedSql).toContain('"Campaign"');
  });

  it('refuses the Admin who approved it with 403, and the Payout stays APPROVED', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    const { tx, state, rows, queryRaw } = makeTx({ payout: makeApprovedPayout(), ledgerRows: INSTRUCTED_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('TWO_PERSON_RULE');
    expect(state).toMatchObject({ status: 'APPROVED', completedById: null, proofImage: null });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it('refuses an Admin who is the Campaign Fundraiser with 403, and the Payout stays APPROVED', async () => {
    // creator-1 requested the Payout; they are not the approver, so the
    // two-person comparison alone would let them through.
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', assignments: ['ADMIN'] } });
    const { tx, state, rows } = makeTx({ payout: makeApprovedPayout(), ledgerRows: INSTRUCTED_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('OWN_CAMPAIGN_CONFLICT');
    expect(state).toMatchObject({ status: 'APPROVED', completedById: null });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it.each(['SUSPENDED', 'CANCELLED'])(
    'answers 409 PAYOUT_NOT_ALLOWED_FOR_STATUS when the Campaign is %s by completion time, leaving the Payout APPROVED and posting nothing',
    async (lifecycleStatus) => {
      const { tx, state, rows } = makeTx({ payout: makeApprovedPayout(), ledgerRows: INSTRUCTED_ROWS, lifecycleStatus });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const response = await POST(createRequest(), routeContext());
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('PAYOUT_NOT_ALLOWED_FOR_STATUS');
      expect(state).toMatchObject({ status: 'APPROVED', completedById: null });
      expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
    },
  );

  it('answers 404 PAYOUT_NOT_FOUND when the Payout is gone by the time completion reads it', async () => {
    const { tx } = makeTx({ payout: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('PAYOUT_NOT_FOUND');
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it('answers 409 when the Payout is not APPROVED', async () => {
    const { tx, state, rows } = makeTx({ payout: makeApprovedPayout({ status: 'DRAFT' }), ledgerRows: INSTRUCTED_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_PAYOUT_STATUS');
    expect(state).toMatchObject({ status: 'DRAFT' });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
    expect(tx.payout.updateMany).not.toHaveBeenCalled();
  });

  it('never resolves a payment provider -- the transfer is performed by hand in the provider dashboard', async () => {
    // Regression guard on ADR 0006. A Payout completion is the one place a
    // provider call would be most tempting, and the least allowed: the
    // money moves on the second Admin's record of a transfer they made by
    // hand. Also guards against getPaymentProvider being called to fetch
    // the proof or the providerRef.
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('MOCK_MIDTRANS_SERVER_KEY');
    });
    const { tx } = makeTx({ payout: makeApprovedPayout(), ledgerRows: INSTRUCTED_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockGetPaymentProvider).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).toHaveBeenCalled();
  });
});
