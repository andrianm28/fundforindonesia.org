import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma. This is the single place money becomes real, so the tests
// below assert on the actual rows handed to ledgerEntry.createMany (real
// postTransaction runs against this fake tx) rather than on whether
// postTransaction was merely called.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    webhookEvent: { create: vi.fn() },
    payment: { findUnique: vi.fn(), update: vi.fn() },
    notification: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Mock the payment provider the same way the donations route tests do: the
// real MockPaymentProvider's signature verification is exercised in
// src/lib/payments/mock-provider.test.ts, so this route only needs
// parseWebhook to resolve or throw the errors it documents.
vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

import { prisma } from '@/lib/prisma';
import {
  getPaymentProvider,
  PaymentProviderNotConfiguredError,
  InvalidWebhookSignatureError,
} from '@/lib/payments';

const mockWebhookEventCreate = prisma.webhookEvent.create as unknown as Mock;
const mockPaymentFindUnique = prisma.payment.findUnique as unknown as Mock;
const mockPaymentUpdate = prisma.payment.update as unknown as Mock;
const mockNotificationCreateMany = prisma.notification.createMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

function createRequest(body: unknown = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/webhooks/mock', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext() {
  return { params: Promise.resolve({ provider: 'mock' }) };
}

type LedgerRow = {
  account: string;
  direction: string;
  amount: number;
  campaignId: string | null;
  transactionId: string;
};

/** A fake tx client backing the settlement transaction: Payment/Donation/
 * Campaign updates plus the real ledger's count/createMany, so postTransaction
 * (not mocked) actually runs and its output can be asserted on. */
function makeTx() {
  const ledgerRows: LedgerRow[] = [];
  const tx = {
    payment: { update: vi.fn().mockResolvedValue({}) },
    donation: { update: vi.fn().mockResolvedValue({}) },
    campaign: { update: vi.fn().mockResolvedValue({}) },
    ledgerEntry: {
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        ledgerRows.push(...data);
        return { count: data.length };
      }),
    },
  };
  return { tx, ledgerRows };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    amount: 100_000,
    status: 'PENDING',
    donation: {
      id: 'donation-1',
      donorId: 'donor-1',
      campaign: {
        id: 'campaign-1',
        title: 'Test Campaign',
        creatorId: 'creator-1',
        collectedAmount: 0,
        targetAmount: 1_000_000,
      },
    },
    ...overrides,
  };
}

const PAID_EVENT = {
  provider: 'mock',
  providerEventId: 'evt-1',
  providerOrderId: 'donation-1',
  status: 'paid' as const,
  rawPayload: { order_id: 'donation-1', transaction_status: 'settlement' },
};

describe('POST /api/webhooks/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
    mockNotificationCreateMany.mockResolvedValue({ count: 0 });
  });

  it('answers 503 and writes nothing when the provider is not configured', async () => {
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('MOCK_MIDTRANS_SERVER_KEY');
    });

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(503);
    // Not a silent accept: nothing at all is written when we cannot verify.
    expect(mockWebhookEventCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('answers 401 and writes nothing when the signature is invalid', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockRejectedValue(new InvalidWebhookSignatureError()),
    });

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(mockWebhookEventCreate).not.toHaveBeenCalled();
    expect(mockPaymentFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('settles a paid event with balanced ledger entries landing in escrow, not the withdrawable balance', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);

    // The legs themselves, not just that postTransaction was called: gross
    // debited from clearing, the full net (fee is 0 for the mock provider)
    // credited to ESCROW_HOLD, and debits equal credits.
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000, campaignId: null }),
    );
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 100_000, campaignId: 'campaign-1' }),
    );
    expect(ledgerRows.some((r) => r.account === 'CAMPAIGN_BALANCE')).toBe(false);
    const debits = ledgerRows.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    const credits = ledgerRows.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);

    // Idempotency key ties the ledger to the same event the WebhookEvent
    // table deduplicates on -- the two cannot disagree.
    expect(ledgerRows.every((r) => r.transactionId === 'webhook:mock:evt-1')).toBe(true);

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: expect.objectContaining({ status: 'PAID', providerFee: 0 }),
    });
    const paymentUpdateData = (tx.payment.update as Mock).mock.calls[0][0].data;
    expect(paymentUpdateData.escrowReleaseAt.getTime() - paymentUpdateData.paidAt.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );

    expect(tx.donation.update).toHaveBeenCalledWith({
      where: { id: 'donation-1' },
      data: { paymentStatus: 'confirmed' },
    });
    expect(tx.campaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { collectedAmount: { increment: 100_000 } },
    });
  });

  it('marks the campaign completed when settlement meets the target', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(
      makePayment({
        donation: {
          id: 'donation-1',
          donorId: 'donor-1',
          campaign: {
            id: 'campaign-1',
            title: 'Test Campaign',
            creatorId: 'creator-1',
            collectedAmount: 900_000,
            targetAmount: 1_000_000,
          },
        },
      }),
    );
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(tx.campaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { collectedAmount: { increment: 100_000 }, status: 'completed' },
    });
  });

  it('marks failed/expired events without posting any ledger entries', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, status: 'expired', providerEventId: 'evt-2' }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    mockPaymentUpdate.mockResolvedValue({});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockPaymentUpdate).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    });
    // No money moved: postTransaction is never reached for failed/expired.
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('logs and answers 200 without ever creating a Payment for an unknown providerRef', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent on a replayed event: the WebhookEvent unique constraint stops it before any Payment lookup', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    // Simulates the @@unique([provider, providerEventId]) constraint firing
    // on a duplicate delivery.
    mockWebhookEventCreate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    // A non-200 here would make the provider retry harder, not less.
    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockPaymentFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects an event for a Payment already in a terminal status, without reprocessing it', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ status: 'PAID' }));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
  });
});
