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
    },
    prayer: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
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
import { POST as balanceDonate } from '@/app/api/balance/donate/route';

// Typed mock references
const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockUserFindUnique = prisma.user.findUnique as unknown as Mock;
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

/**
 * Fake tx client backing POST /api/donations' donation + payment
 * transaction. Mirrors what src/app/api/donations/route.ts actually calls:
 * tx.donation.create then tx.payment.create.
 */
function makeDonationTx(donation: Record<string, unknown>) {
  return {
    donation: { create: vi.fn().mockResolvedValue(donation) },
    payment: { create: vi.fn().mockResolvedValue({ id: 'payment-1' }) },
  };
}

const VA_EXPIRY = new Date('2099-01-02T00:00:00.000Z');

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

  describe('1. Donation creation validates campaign is active', () => {
    it('should reject donation when campaign is completed', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-1',
        status: 'completed',
        title: 'Completed Campaign',
      });

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-1',
        amount: 50000,
        paymentMethod: 'bank_transfer',
      });

      const response = await createDonation(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('tidak aktif');
    });

    it('should reject donation when campaign is expired', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-2',
        status: 'expired',
        title: 'Expired Campaign',
      });

      // bank_transfer, not ewallet: this test is about campaign state, not
      // payment method availability -- ewallet would now be rejected earlier
      // with 503 regardless of campaign status.
      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-2',
        amount: 25000,
        paymentMethod: 'bank_transfer',
      });

      const response = await createDonation(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('tidak aktif');
    });

    it('should allow donation when campaign is active', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-3',
        status: 'active',
        title: 'Active Campaign',
      });
      const tx = makeDonationTx({
        id: 'donation-new',
        amount: 50000,
        paymentMethod: 'bank_transfer',
        paymentStatus: 'pending',
        campaignId: 'campaign-3',
        donorId: 'user-1',
      });
      mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-3',
        amount: 50000,
        paymentMethod: 'bank_transfer',
      });

      const response = await createDonation(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.donationId).toBe('donation-new');
      expect(data.paymentStatus).toBe('pending');
    });
  });

  describe('2. Donation creation creates prayer when message is included', () => {
    it('should create prayer record when message is provided in donation', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-1',
        status: 'active',
        title: 'Campaign With Prayer',
      });
      const tx = makeDonationTx({
        id: 'donation-prayer',
        amount: 100000,
        paymentMethod: 'bank_transfer',
        paymentStatus: 'pending',
        campaignId: 'campaign-1',
        donorId: 'user-1',
        message: 'Semoga cepat sembuh ya',
      });
      mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));
      const mockPrayerCreate = prisma.prayer.create as unknown as Mock;
      mockPrayerCreate.mockResolvedValue({
        id: 'prayer-1',
        text: 'Semoga cepat sembuh ya',
        donationId: 'donation-prayer',
      });

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-1',
        amount: 100000,
        paymentMethod: 'bank_transfer',
        message: 'Semoga cepat sembuh ya',
      });

      const response = await createDonation(request);

      expect(response.status).toBe(201);
      expect(mockPrayerCreate).toHaveBeenCalledWith({
        data: {
          text: 'Semoga cepat sembuh ya',
          donationId: 'donation-prayer',
          campaignId: 'campaign-1',
          userId: 'user-1',
        },
      });
    });

    it('should NOT create prayer when no message is provided', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-1',
        status: 'active',
        title: 'Campaign No Prayer',
      });
      const tx = makeDonationTx({
        id: 'donation-no-prayer',
        amount: 25000,
        paymentMethod: 'bank_transfer',
        paymentStatus: 'pending',
        campaignId: 'campaign-1',
        donorId: 'user-1',
        message: null,
      });
      mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));
      const mockPrayerCreate = prisma.prayer.create as unknown as Mock;

      const request = createPostRequest('http://localhost:3000/api/donations', {
        campaignId: 'campaign-1',
        amount: 25000,
        paymentMethod: 'bank_transfer',
      });

      await createDonation(request);

      expect(mockPrayerCreate).not.toHaveBeenCalled();
    });
  });

  // Confirming a donation used to be an ADMIN-only PATCH endpoint
  // (POST /api/donations/[id]/confirm). Task M4 deleted it: that job now
  // belongs to the payment provider's webhook, not a human clicking a button.
  // The behaviour these tests asserted -- updating paymentStatus, incrementing
  // campaign.collectedAmount, sending donor/creator notifications, AND the
  // status guards (unknown donation, already-confirmed, already-failed) -- is
  // not gone, it moves to the webhook handler landing in task M5. The guards
  // matter MORE under a webhook than they did under the old endpoint: a
  // provider retries deliveries automatically, so the webhook also needs
  // idempotency against a replayed event, or a retried notification
  // double-processes a payment. All of it is left as it.todo rather than
  // deleted so the requirement stays visible until M5 rewrites it against the
  // webhook route.
  describe('3. Confirmation endpoint updates donation status and increments campaign amount', () => {
    it.todo('should confirm donation, update status, and increment collectedAmount');
    it.todo('should mark campaign as completed when collectedAmount meets targetAmount');
  });

  describe('4. Confirmation creates notifications for donor and creator', () => {
    it.todo('should create notifications for both donor and campaign creator');
    it.todo('should only create creator notification when donation is anonymous (no donorId)');
  });

  // See the comment above describe block 3 -- these are the status guards the
  // old ADMIN confirm endpoint had (404 unknown donation, 400 already
  // confirmed, 400 already failed) plus the idempotency guard a webhook needs
  // that a human-clicked endpoint never did. Named for task M5.
  describe('5. Payment status guards move to the M5 webhook', () => {
    it.todo('should reject a webhook event whose providerRef matches no Payment');
    it.todo('should not double-process a replayed webhook event (idempotent by provider event id)');
    it.todo('should reject a webhook event for a Payment already in a terminal status (PAID/FAILED/EXPIRED)');
  });

  describe('6. Balance donation deducts from user balance', () => {
    it('should deduct balance and create confirmed donation in one transaction', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-balance', name: 'Balance User', email: 'balance@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-bal',
        status: 'active',
        targetAmount: 1000000,
        collectedAmount: 400000,
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 200000,
      });
      mockTransaction.mockResolvedValue([
        { donationBalance: 150000 }, // new user balance after deduction
        { id: 'donation-bal', amount: 50000 }, // created donation
        { id: 'campaign-bal', collectedAmount: 450000 }, // updated campaign
      ]);

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-bal',
        amount: 50000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.donationId).toBe('donation-bal');
      expect(data.newBalance).toBe(150000);
      expect(data.message).toBe('Donasi berhasil');
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('7. Balance donation rejects when insufficient balance', () => {
    it('should return 400 with current balance info when balance is too low', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-low', name: 'Low Balance', email: 'low@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-x',
        status: 'active',
        targetAmount: 500000,
        collectedAmount: 100000,
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 20000,
      });

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-x',
        amount: 50000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Saldo tidak mencukupi');
      expect(data.currentBalance).toBe(20000);
      // Transaction should NOT be called
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should reject when balance is exactly zero', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-zero', name: 'Zero Balance', email: 'zero@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-y',
        status: 'active',
        targetAmount: 500000,
        collectedAmount: 100000,
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 0,
      });

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-y',
        amount: 10000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Saldo tidak mencukupi');
      expect(data.currentBalance).toBe(0);
    });
  });

  describe('8. Balance donation marks campaign as completed when target met', () => {
    it('should mark campaign as completed when donation causes collectedAmount >= targetAmount', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-complete', name: 'Final Donor', email: 'final@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-almost',
        status: 'active',
        targetAmount: 100000,
        collectedAmount: 80000, // 80000 + 30000 = 110000 >= 100000
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 50000,
      });
      mockTransaction.mockResolvedValue([
        { donationBalance: 20000 },
        { id: 'donation-final', amount: 30000 },
        { id: 'campaign-almost', collectedAmount: 110000, status: 'completed' },
      ]);

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-almost',
        amount: 30000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.donationId).toBe('donation-final');
      // The transaction was called - verify the campaign should be marked complete
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should NOT mark campaign as completed when donation does not meet target', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user-partial', name: 'Partial Donor', email: 'partial@test.com' },
      });
      mockCampaignFindUnique.mockResolvedValue({
        id: 'campaign-partial',
        status: 'active',
        targetAmount: 1000000,
        collectedAmount: 200000, // 200000 + 50000 = 250000 < 1000000
      });
      mockUserFindUnique.mockResolvedValue({
        donationBalance: 100000,
      });
      mockTransaction.mockResolvedValue([
        { donationBalance: 50000 },
        { id: 'donation-partial', amount: 50000 },
        { id: 'campaign-partial', collectedAmount: 250000, status: 'active' },
      ]);

      const request = createPostRequest('http://localhost:3000/api/balance/donate', {
        campaignId: 'campaign-partial',
        amount: 50000,
      });

      const response = await balanceDonate(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.donationId).toBe('donation-partial');
      expect(mockTransaction).toHaveBeenCalled();
    });
  });
});
