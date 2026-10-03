import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';
import { readRefundDonorAccountNumber } from '@/lib/contact-fields';

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

/**
 * The freeze createRefund posts for makeRefundRow's default Refund (40_000 of a
 * Payment with a 5_000 Provider Fee, so a 2_000 share), which approval reads
 * back (prd-compliance 51): the Net it took out of ESCROW_HOLD and the Provider
 * Fee share booked to REFUND_COST. Without it approval refuses the Refund.
 */
const FREEZE_OF_DEFAULT_REFUND = [
  { transactionId: 'refund-requested-refund-1', account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 40_000 },
  { transactionId: 'refund-requested-refund-1', account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 38_000 },
  { transactionId: 'refund-requested-refund-1', account: 'REFUND_COST', direction: 'DEBIT', amount: 2_000 },
];

function makeTx(options: { refundRow?: Record<string, unknown> | null; campaignCreatorId?: string } = {}) {
  const state = options.refundRow ? { ...options.refundRow } : null;
  return {
    tx: {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      // The Campaign row the subject guard reads under that lock.
      campaign: {
        findUnique: vi.fn().mockResolvedValue({
          creatorId: options.campaignCreatorId ?? 'fundraiser-1',
          isDemo: false,
          lifecycleStatus: 'ACTIVE',
          deadline: null,
        }),
      },
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
        // The freeze approval reads back, selected by its transactionId.
        findMany: vi.fn(async ({ where }: { where: { transactionId: string } }) =>
          FREEZE_OF_DEFAULT_REFUND.filter((r) => r.transactionId === where.transactionId),
        ),
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

const validDestination = {
  donorBankCode: 'BCA',
  donorAccountName: 'Budi Santoso',
  donorAccountNumber: '1234567890',
};

function patchRequest(body: Record<string, unknown> = validDestination): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/refunds/refund-1/approve', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function routeContext(id = 'refund-1') {
  return { params: Promise.resolve({ slug: 'test-campaign', id }) };
}

describe('PATCH /api/campaigns/[slug]/refunds/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
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
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', assignments: ['VERIFIER'] } });
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails the schema (wrong types)', async () => {
    const response = await PATCH(patchRequest({ donorBankCode: 1 } as never), routeContext());
    expect(response.status).toBe(400);
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

  it('approves a REQUESTED refund with a destination and returns 200 with the updated status', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('APPROVED');
  });

  it('records the sealed donor account number on approval, decrypting back to what was typed', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    await PATCH(patchRequest(), routeContext());

    const call = (tx.refund.updateMany as Mock).mock.calls[0][0];
    expect(call.data.donorBankCode).toBe('BCA');
    expect(call.data.donorAccountName).toBe('Budi Santoso');
    expect(call.data.donorAccountNumberCiphertext).not.toBe('1234567890');
    expect(
      readRefundDonorAccountNumber({
        donorAccountNumberCiphertext: call.data.donorAccountNumberCiphertext,
        donorAccountNumberKeyId: call.data.donorAccountNumberKeyId,
      }),
    ).toBe('1234567890');
  });

  it('returns 400 REFUND_DESTINATION_INVALID when approving without a destination, posting nothing', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest({ ...validDestination, donorAccountNumber: '' }), routeContext());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('REFUND_DESTINATION_INVALID');
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('returns 400 REFUND_DESTINATION_INVALID for a blank bank code, posting nothing', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest({ ...validDestination, donorBankCode: '   ' }), routeContext());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('REFUND_DESTINATION_INVALID');
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('never echoes the account number back in the success response', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    const text = await response.text();

    expect(text).not.toContain('1234567890');
  });

  it('returns 403 when the approver is the same person who requested it', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'requester-1', assignments: ['ADMIN'] } });
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('SELF_APPROVAL');
  });

  it("returns 403 OWN_CAMPAIGN_CONFLICT when the approving Admin is the Campaign's own Fundraiser, leaving the Refund REQUESTED", async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow(), campaignCreatorId: 'admin-2' });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT', error: expect.stringContaining('harus dilakukan Admin lain') });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 REFUND_NOT_FOUND when the Refund is gone by the time approval reads it', async () => {
    const { tx } = makeTx({ refundRow: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('REFUND_NOT_FOUND');
  });

  it('returns 409 when the refund is no longer REQUESTED', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow({ status: 'APPROVED' }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_REFUND_STATUS');
  });
});
