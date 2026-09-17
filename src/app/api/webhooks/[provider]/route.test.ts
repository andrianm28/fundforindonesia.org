import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma. This is the single place money becomes real, so the tests
// below assert on the actual rows handed to ledgerEntry.createMany (real
// postTransaction runs against this fake tx) rather than on whether
// postTransaction was merely called.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    webhookEvent: { create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    payment: { findUnique: vi.fn() },
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
const mockWebhookEventUpdate = prisma.webhookEvent.update as unknown as Mock;
const mockWebhookEventFindUniqueOrThrow = prisma.webhookEvent.findUniqueOrThrow as unknown as Mock;
const mockPaymentFindUnique = prisma.payment.findUnique as unknown as Mock;
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

/**
 * A fake tx client backing the settlement transaction: Payment/Donation/
 * Campaign updates plus the real ledger's count/createMany, so postTransaction
 * (not mocked) actually runs and its output can be asserted on.
 *
 * `paymentUpdateManyCount` simulates what the database itself decides: 1 is
 * the normal "this delivery won" case, 0 simulates a concurrent, distinct
 * event having already flipped the Payment out of PENDING first.
 */
function makeTx(options: { paymentUpdateManyCount?: number } = {}) {
  const { paymentUpdateManyCount = 1 } = options;
  const ledgerRows: LedgerRow[] = [];
  const tx = {
    payment: { updateMany: vi.fn().mockResolvedValue({ count: paymentUpdateManyCount }) },
    donation: { update: vi.fn().mockResolvedValue({}) },
    campaign: { update: vi.fn().mockResolvedValue({}) },
    webhookEvent: { update: vi.fn().mockResolvedValue({}) },
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
  // Matches makePayment()'s default amount -- tests that want a mismatch
  // override this explicitly.
  grossAmount: 100_000,
  rawPayload: { order_id: 'donation-1', transaction_status: 'settlement' },
};

describe('POST /api/webhooks/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
    mockWebhookEventUpdate.mockResolvedValue({});
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

    // Keyed on status too, not just id: the database, not a prior read,
    // decides whether this delivery is the one that gets to settle.
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'PAID', providerFee: 0 }),
    });
    const paymentUpdateData = (tx.payment.updateMany as Mock).mock.calls[0][0].data;
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

    // processedAt is stamped inside the same transaction, as the last
    // write -- a crash before this line must leave the row unprocessed.
    expect(tx.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date) },
    });

    expect(mockNotificationCreateMany).toHaveBeenCalled();
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

  it('refuses to settle when the signed gross amount disagrees with the Payment, and does not open a transaction', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, grossAmount: 40_000 }),
    });
    // Payment.amount is 100_000 (makePayment's default) -- the provider is
    // vouching for a different, smaller amount: an underpaid VA or a
    // partial capture, not a full settlement of the original charge.
    mockPaymentFindUnique.mockResolvedValue(makePayment());

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    // Refuses to settle: no transaction, no money moved, no status flip that
    // would tell the donor their donation either succeeded or failed.
    expect(mockTransaction).not.toHaveBeenCalled();
    // But the event is still recorded as looked-at, so a plain retry of the
    // same mismatched event does not re-run this logic forever silently --
    // it logs again, which is the point.
    expect(mockWebhookEventUpdate).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it.each([
    ['expired', 'EXPIRED'],
    ['deny', 'FAILED'],
  ] as const)(
    'marks the Payment %s and the Donation failed, without posting any ledger entries',
    async (eventStatus, expectedPaymentStatus) => {
      mockGetPaymentProvider.mockReturnValue({
        parseWebhook: vi.fn().mockResolvedValue({
          ...PAID_EVENT,
          status: eventStatus === 'expired' ? 'expired' : 'failed',
          providerEventId: 'evt-2',
        }),
      });
      mockPaymentFindUnique.mockResolvedValue(makePayment());
      const { tx } = makeTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      const response = await POST(createRequest(), routeContext());

      expect(response.status).toBe(200);
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: expect.objectContaining({ status: expectedPaymentStatus }),
      });
      // Donation.paymentStatus only ever has pending/confirmed/failed -- both
      // provider outcomes land on 'failed' so the donor's own page stops
      // reading "pending" for an attempt that will never complete.
      expect(tx.donation.update).toHaveBeenCalledWith({
        where: { id: 'donation-1' },
        data: { paymentStatus: 'failed' },
      });
      // No money moved: postTransaction/the campaign are never touched.
      expect(tx.campaign.update).not.toHaveBeenCalled();
      expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    },
  );

  it('logs and answers 200 without ever creating a Payment for an unknown providerRef', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('is idempotent on a replayed event that already finished: the existing processed row short-circuits before any Payment lookup', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    // Simulates the @@unique([provider, providerEventId]) constraint firing
    // on a duplicate delivery of an event that was already fully handled.
    mockWebhookEventCreate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));
    mockWebhookEventFindUniqueOrThrow.mockResolvedValue({ id: 'we-1', processedAt: new Date() });

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    // A non-200 here would make the provider retry harder, not less.
    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockPaymentFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('resumes settlement for a WebhookEvent row that exists but was never marked processed, instead of treating it as a duplicate', async () => {
    // Simulates recovery after a transient failure: an earlier delivery of
    // this exact event got as far as inserting the WebhookEvent row, then
    // the settlement transaction never committed (dropped connection,
    // deadlock, any throw before commit) -- so processedAt is still null.
    // This is NOT a duplicate; treating it as one would strand the Payment
    // in PENDING forever with the donor's money already at the provider.
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockWebhookEventCreate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));
    mockWebhookEventFindUniqueOrThrow.mockResolvedValue({ id: 'we-1', processedAt: null });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    // The settlement actually ran this time -- it was not skipped as a
    // "duplicate".
    expect(mockPaymentFindUnique).toHaveBeenCalled();
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'PAID' }),
    });
    expect(ledgerRows).toHaveLength(2);
    expect(tx.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('does not double-settle when two distinct events race for the same Payment: the loser sees the database say no', async () => {
    // Two DIFFERENT providerEventIds for the same Payment (so both clear the
    // WebhookEvent constraint independently) both read PENDING before either
    // writes. The updateMany's own WHERE (id + status: PENDING) is what
    // actually decides the winner -- simulated here by the fake tx returning
    // count: 0, exactly what a real database returns for the loser.
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx, ledgerRows } = makeTx({ paymentUpdateManyCount: 0 });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    // No double credit: nothing past the updateMany runs for the loser.
    expect(tx.donation.update).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
    expect(ledgerRows).toHaveLength(0);
    expect(mockNotificationCreateMany).not.toHaveBeenCalled();
    // The loser is still a finished event, not an unprocessed one.
    expect(tx.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('rejects an event for a Payment already in a terminal status, without reprocessing it', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ status: 'PAID' }));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
