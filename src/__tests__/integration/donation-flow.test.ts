import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Mock prisma globally for the integration test
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    donation: {
      create: vi.fn(),
      // The webhook re-reads anonymisedAt right before the Receipt email
      // (ticket 36); an ordinary, non-anonymised Donation by default.
      findUnique: vi.fn().mockResolvedValue({ anonymisedAt: null }),
    },
    prayer: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
    },
    webhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    notification: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock the payment provider. The real MockPaymentProvider (charge issuance,
// webhook signature verification) is exercised in
// src/lib/payments/mock-provider.test.ts; this integration test only needs
// createCharge to return something so POST /api/donations can run end to end.
vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';

// Import route handlers
import { POST as createDonation } from '@/app/api/donations/route';
import { POST as webhook } from '@/app/api/webhooks/[provider]/route';

// Typed mock references
const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockUserFindUnique = prisma.user.findUnique as unknown as Mock;
const mockPaymentFindUnique = prisma.payment.findUnique as unknown as Mock;
const mockWebhookEventCreate = prisma.webhookEvent.create as unknown as Mock;
const mockWebhookEventUpdate = prisma.webhookEvent.update as unknown as Mock;
const mockNotificationCreateMany = prisma.notification.createMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

// Helper to create POST requests
function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const VA_EXPIRY = new Date('2099-01-02T00:00:00.000Z');

/** Builds a webhook POST request for src/app/api/webhooks/[provider]/route.ts. */
function createWebhookRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/webhooks/mock', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function webhookContext() {
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
 * Fake tx client backing the webhook's settlement transaction. Runs the real
 * postTransaction (not mocked), so the ledger rows it actually writes can be
 * asserted on directly rather than asserting postTransaction was merely
 * called.
 */
function makeWebhookTx() {
  const ledgerRows: LedgerRow[] = [];
  const tx = {
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    donation: {
      update: vi.fn().mockResolvedValue({}),
      // The abuse thresholds read the settled Donation back (prd-compliance
      // 38). An ordinary Donation, so this flow's own assertions are about
      // the money and not about the markers.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        amount: 75_000,
        campaign: { id: 'campaign-webhook-1', collectedAmount: 75_000, isDemo: false },
      })),
    },
    campaign: { update: vi.fn().mockResolvedValue({}) },
    abuseThreshold: { findMany: vi.fn(async () => []) },
    receipt: { create: vi.fn().mockResolvedValue({}) },
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

function makeWebhookPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-webhook-1',
    // Must equal the provider the webhook event is verified by (the 'mock' route
    // and WEBHOOK_EVENT below); the route refuses a Payment from another provider (ticket 51).
    provider: 'mock',
    amount: 75_000,
    status: 'PENDING',
    donationId: 'donation-webhook-1',
    registrationId: null,
    donation: {
      id: 'donation-webhook-1',
      donorId: 'donor-webhook-1',
      campaign: {
        id: 'campaign-webhook-1',
        title: 'Webhook Test Campaign',
        creatorId: 'creator-webhook-1',
        collectedAmount: 200_000,
        targetAmount: 1_000_000,
      },
    },
    registration: null,
    ...overrides,
  };
}

// T+0 -- paidAt and settledAt equal, matching MockPaymentProvider's own
// behaviour for a provider with no separate settlement estimate
// (prd-compliance 19).
const WEBHOOK_PROVIDER_PAID_AT = new Date('2026-09-20T10:00:00Z');

const WEBHOOK_PAID_EVENT = {
  provider: 'mock',
  providerEventId: 'evt-webhook-1',
  providerOrderId: 'donation-webhook-1',
  status: 'paid' as const,
  // Matches makeWebhookPayment()'s default amount.
  grossAmount: 75_000,
  rawPayload: { order_id: 'donation-webhook-1', transaction_status: 'settlement' },
  paidAt: WEBHOOK_PROVIDER_PAID_AT,
  settledAt: WEBHOOK_PROVIDER_PAID_AT,
};

describe('Donation Flow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPaymentProvider.mockReturnValue({
      createCharge: vi.fn().mockResolvedValue({
        providerOrderId: 'order',
        method: 'bank_transfer_va',
        vaNumber: '8808123456789',
        expiresAt: VA_EXPIRY,
      }),
    });
  });

  // Sections 1-2 used to cover the campaign-active guard and prayer creation
  // inside POST /api/donations end to end. Donations are now disabled
  // (DONATIONS_ENABLED = false, src/lib/donations.ts): getPaymentProvider()
  // resolves to MockPaymentProvider, which fabricates a VA number no bank
  // issued and no donor could ever pay -- see that constant's doc comment.
  // The route now refuses every request before the campaign is ever looked
  // up, so every scenario below is unreachable; these tests now assert the
  // 503 gate instead.
  describe('1. Donations are disabled', () => {
    it('returns 503 regardless of campaign status, before looking up the campaign', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-1',
        amount: 50000,
        paymentMethod: 'bank_transfer',
      });

      const response = await createDonation(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(typeof data.error).toBe('string');
      expect(mockCampaignFindUnique).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  describe('2. Donation creation never reaches the prayer step while disabled', () => {
    it('does not create a prayer even when a message is provided', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      const mockPrayerCreate = prisma.prayer.create as unknown as Mock;

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-1',
        amount: 100000,
        paymentMethod: 'bank_transfer',
        message: 'Semoga cepat sembuh ya',
      });

      const response = await createDonation(request);

      expect(response.status).toBe(503);
      expect(mockPrayerCreate).not.toHaveBeenCalled();
    });
  });

  // Confirming a donation used to be an ADMIN-only PATCH endpoint
  // (POST /api/donations/[id]/confirm). Task M4 deleted it: that job now
  // belongs to the payment provider's webhook, not a human clicking a button.
  // The behaviour these tests asserted -- updating paymentStatus, incrementing
  // campaign.collectedAmount, sending donor/creator notifications, AND the
  // status guards (unknown donation, already-confirmed, already-failed) --
  // was not gone, it moved to the webhook handler in task M5, which is what
  // these describe blocks now exercise via POST /api/webhooks/[provider]. The
  // guards matter MORE under a webhook than they did under the old endpoint:
  // a provider retries deliveries automatically, so the webhook also needs
  // idempotency against a replayed event, or a retried notification would
  // double-process a payment.
  describe('3. Confirmation endpoint updates donation status and increments campaign amount', () => {
    beforeEach(() => {
      mockGetPaymentProvider.mockReturnValue({
        parseWebhook: vi.fn().mockResolvedValue(WEBHOOK_PAID_EVENT),
      });
      mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
      mockWebhookEventUpdate.mockResolvedValue({});
      mockNotificationCreateMany.mockResolvedValue({ count: 0 });
    });

    it('[M5 webhook] should confirm donation, update status, and increment collectedAmount', async () => {
      mockPaymentFindUnique.mockResolvedValue(makeWebhookPayment());
      const { tx } = makeWebhookTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      const response = await webhook(createWebhookRequest({}), webhookContext());

      expect(response.status).toBe(200);
      expect(tx.donation.update).toHaveBeenCalledWith({
        where: { id: 'donation-webhook-1' },
        data: { paymentStatus: 'confirmed' },
      });
      expect(tx.campaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-webhook-1' },
        data: { collectedAmount: { increment: 75_000 } },
      });
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-webhook-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'PAID' }),
      });
    });

    // ADR 0004: reaching the target does not close a Campaign; only the
    // Fundraiser or an Admin marks it COMPLETED.
    it('[M5 webhook] should leave the campaign status alone when collectedAmount passes targetAmount', async () => {
      mockPaymentFindUnique.mockResolvedValue(
        makeWebhookPayment({
          donation: {
            id: 'donation-webhook-1',
            donorId: 'donor-webhook-1',
            campaign: {
              id: 'campaign-webhook-1',
              title: 'Webhook Test Campaign',
              creatorId: 'creator-webhook-1',
              collectedAmount: 950_000,
              targetAmount: 1_000_000,
            },
          },
        }),
      );
      const { tx } = makeWebhookTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      await webhook(createWebhookRequest({}), webhookContext());

      expect(tx.campaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-webhook-1' },
        data: { collectedAmount: { increment: 75_000 } },
      });
      expect(tx.campaign.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Confirmation creates notifications for donor and creator', () => {
    beforeEach(() => {
      mockGetPaymentProvider.mockReturnValue({
        parseWebhook: vi.fn().mockResolvedValue(WEBHOOK_PAID_EVENT),
      });
      mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
      mockWebhookEventUpdate.mockResolvedValue({});
      mockNotificationCreateMany.mockResolvedValue({ count: 0 });
    });

    it('[M5 webhook] should create notifications for both donor and campaign creator', async () => {
      mockPaymentFindUnique.mockResolvedValue(makeWebhookPayment());
      const { tx } = makeWebhookTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      await webhook(createWebhookRequest({}), webhookContext());

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ userId: 'donor-webhook-1' }),
          expect.objectContaining({ userId: 'creator-webhook-1' }),
        ],
      });
    });

    it('[M5 webhook] should only create creator notification when donation is anonymous (no donorId)', async () => {
      mockPaymentFindUnique.mockResolvedValue(
        makeWebhookPayment({
          donation: {
            id: 'donation-webhook-1',
            donorId: null,
            campaign: {
              id: 'campaign-webhook-1',
              title: 'Webhook Test Campaign',
              creatorId: 'creator-webhook-1',
              collectedAmount: 200_000,
              targetAmount: 1_000_000,
            },
          },
        }),
      );
      const { tx } = makeWebhookTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      await webhook(createWebhookRequest({}), webhookContext());

      expect(mockNotificationCreateMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ userId: 'creator-webhook-1' })],
      });
    });
  });

  // See the comment above describe block 3 -- these are the status guards the
  // old ADMIN confirm endpoint had (404 unknown donation, 400 already
  // confirmed, 400 already failed) plus the idempotency guard a webhook needs
  // that a human-clicked endpoint never did.
  describe('5. Payment status guards move to the M5 webhook', () => {
    beforeEach(() => {
      mockGetPaymentProvider.mockReturnValue({
        parseWebhook: vi.fn().mockResolvedValue(WEBHOOK_PAID_EVENT),
      });
      mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
      mockWebhookEventUpdate.mockResolvedValue({});
      mockNotificationCreateMany.mockResolvedValue({ count: 0 });
    });

    it('[M5 webhook] should reject a webhook event whose providerRef matches no Payment', async () => {
      mockPaymentFindUnique.mockResolvedValue(null);

      const response = await webhook(createWebhookRequest({}), webhookContext());
      const data = await response.json();

      // Retrying forever helps nobody, so this is 200 -- but no Payment is
      // ever created for an event nobody can attribute.
      expect(response.status).toBe(200);
      expect(data.received).toBe(true);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('[M5 webhook] should not double-process a replayed webhook event (idempotent by provider event id)', async () => {
      // The WebhookEvent @@unique([provider, providerEventId]) constraint
      // firing on a duplicate delivery of an event that was already fully
      // processed.
      mockWebhookEventCreate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));
      const mockWebhookEventFindUniqueOrThrow = prisma.webhookEvent.findUniqueOrThrow as unknown as Mock;
      mockWebhookEventFindUniqueOrThrow.mockResolvedValue({ id: 'we-1', processedAt: new Date() });

      const response = await webhook(createWebhookRequest({}), webhookContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.received).toBe(true);
      expect(mockPaymentFindUnique).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('[M5 webhook] should reject a webhook event for a Payment already in a terminal status (PAID/FAILED/EXPIRED)', async () => {
      mockPaymentFindUnique.mockResolvedValue(makeWebhookPayment({ status: 'PAID' }));

      const response = await webhook(createWebhookRequest({}), webhookContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.received).toBe(true);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });
});
