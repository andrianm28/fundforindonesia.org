import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
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
    paymentProviderSetting: { findFirst: vi.fn() },
    donation: { findUnique: vi.fn() },
    notification: { createMany: vi.fn(), create: vi.fn() },
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

// The Trip Fee side of a Settlement is the Volunteer Trip module's
// (src/lib/volunteer/trip.ts, tested in trip-registrations.test.ts); this
// route only calls it and acts on what it reports.
vi.mock('@/lib/volunteer/trip', () => ({
  confirmRegistration: vi.fn(),
  expireRegistrationHold: vi.fn(),
  refundLateSettlement: vi.fn(),
}));

// The Receipt token is generated here (not read back from the row), so the
// email send after commit can use it without a second query. Fixed in tests
// so assertions on the print link are exact.
vi.mock('@/lib/receipt-token', () => ({
  generateReceiptToken: vi.fn().mockReturnValue('tok-fixed'),
}));

// Same reasoning as the Receipt token mock above, for the Akad Wakaf token.
vi.mock('@/lib/akad-wakaf-token', () => ({
  generateAkadWakafToken: vi.fn().mockReturnValue('akad-tok-fixed'),
}));

// The Receipt email's own content (Collecting Entity naming, anonymous vs
// named Donor, escaping) is covered independently in
// src/lib/mail/receipt.test.ts; this route only needs to know sendReportingFailure
// was reached with the right recipient.
vi.mock('@/lib/mail', () => ({
  sendReportingFailure: vi.fn().mockResolvedValue(true),
}));

import { sealDonationGuestEmail, sealUserEmail } from '@/lib/contact-fields';
import { prisma } from '@/lib/prisma';
import {
  getPaymentProvider,
  PaymentProviderNotConfiguredError,
  UnknownPaymentProviderError,
  InvalidWebhookSignatureError,
} from '@/lib/payments';
import { confirmRegistration, expireRegistrationHold, refundLateSettlement } from '@/lib/volunteer/trip';
import { sendReportingFailure } from '@/lib/mail';
import { formatRupiah } from '@/lib/utils/currency';
import { MockPaymentProvider } from '@/lib/payments';
import { setEnv } from '../../../../../tests/support/mutable-env';

const mockConfirmRegistration = confirmRegistration as unknown as Mock;
const mockExpireRegistrationHold = expireRegistrationHold as unknown as Mock;
const mockRefundLateSettlement = refundLateSettlement as unknown as Mock;
const mockWebhookEventCreate = prisma.webhookEvent.create as unknown as Mock;
const mockWebhookEventUpdate = prisma.webhookEvent.update as unknown as Mock;
const mockWebhookEventFindUniqueOrThrow = prisma.webhookEvent.findUniqueOrThrow as unknown as Mock;
const mockPaymentFindUnique = prisma.payment.findUnique as unknown as Mock;
const mockDonationFindUnique = prisma.donation.findUnique as unknown as Mock;
const mockNotificationCreateMany = prisma.notification.createMany as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;
const mockSendReportingFailure = sendReportingFailure as unknown as Mock;

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
  volunteerTripId?: string | null;
  transactionId: string;
  /** Which provider this movement went through, stamped by postTransaction. */
  provider?: string | null;
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
  // What the abuse thresholds left behind in the settlement's transaction
  // (prd-compliance 38), as rows rather than as calls: the Donation's
  // marker, the Campaign's audit marker and the Verifikasi Tambahan.
  const donationMarkers: Record<string, unknown>[] = [];
  const auditMarkers: Record<string, unknown>[] = [];
  const verificationRequests: Record<string, unknown>[] = [];
  // Stands in for the threshold history: empty, so the PRD's own numbers are
  // in force, exactly as on a database no Admin has configured yet.
  const thresholds: { kind: string; value: number }[] = [];
  const tx = {
    payment: { updateMany: vi.fn().mockResolvedValue({ count: paymentUpdateManyCount }) },
    donation: {
      update: vi.fn().mockResolvedValue({}),
      // Read by the abuse thresholds (prd-compliance 38) after the
      // collectedAmount increment. An ordinary Donation by default, so a test
      // about thresholds overrides this with the amount it needs.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        amount: 100_000,
        campaign: { id: 'campaign-1', collectedAmount: 100_000, isDemo: false },
      })),
    },
    campaign: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(async () => ({
        id: 'campaign-1',
        creatorId: 'creator-1',
        lifecycleStatus: 'ACTIVE',
        deadline: null,
        kind: 'DONATION',
        collectingEntityId: 'org-1',
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        id: 'campaign-1',
        creatorId: 'creator-1',
        lifecycleStatus: 'ACTIVE',
        deadline: null,
        kind: 'DONATION',
        collectingEntityId: 'org-1',
      })),
    },
    abuseThreshold: { findMany: vi.fn(async () => thresholds) },
    donationReviewMarker: {
      upsert: vi.fn(async ({ where, create }: { where: { donationId: string }; create: Record<string, unknown> }) => {
        const existing = donationMarkers.find((m) => m.donationId === where.donationId);
        if (existing) return existing;
        const row = { id: 'donation-marker-1', ...create };
        donationMarkers.push(row);
        return row;
      }),
    },
    campaignAuditMarker: {
      upsert: vi.fn(async ({ where, create }: { where: { campaignId: string }; create: Record<string, unknown> }) => {
        const existing = auditMarkers.find((m) => m.campaignId === where.campaignId);
        if (existing) return existing;
        const row = { id: 'audit-marker-1', ...create };
        auditMarkers.push(row);
        return row;
      }),
    },
    verificationRequest: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'verification-amount-1', ...data };
        verificationRequests.push(row);
        return row;
      }),
    },
    verificationChecklistItem: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => [{ id: 'campaign-1' }]),
    receipt: { create: vi.fn().mockResolvedValue({}) },
    akadWakaf: { create: vi.fn().mockResolvedValue({}) },
    webhookEvent: { update: vi.fn().mockResolvedValue({}) },
    ledgerEntry: {
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        ledgerRows.push(...data);
        return { count: data.length };
      }),
    },
  };
  return { tx, ledgerRows, donationMarkers, auditMarkers, verificationRequests };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    provider: 'mock',
    amount: 100_000,
    status: 'PENDING',
    escrowHoldDays: 7,
    donationId: 'donation-1',
    registrationId: null,
    donation: {
      id: 'donation-1',
      donorId: 'donor-1',
      guestEmailCiphertext: null,
      guestEmailKeyId: null,
      guestName: null,
      donor: { id: 'donor-1', name: 'Donor Test', ...sealUserEmail('donor@example.test') },
      campaign: {
        id: 'campaign-1',
        title: 'Test Campaign',
        creatorId: 'creator-1',
        collectedAmount: 0,
        targetAmount: 1_000_000,
        collectingEntity: { id: 'org-1', name: 'Yayasan Contoh' },
      },
    },
    registration: null,
    ...overrides,
  };
}

/** Registration-linked (Trip Fee) sibling of makePayment. */
function makeRegistrationPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    provider: 'mock',
    amount: 250_000,
    status: 'PENDING',
    escrowHoldDays: 7,
    donationId: null,
    registrationId: 'registration-1',
    donation: null,
    registration: {
      id: 'registration-1',
      volunteerId: 'volunteer-1',
      status: 'HOLD',
      batch: {
        tripId: 'trip-1',
        trip: {
          id: 'trip-1',
          slug: 'bersih-pantai',
          title: 'Bersih Pantai',
        },
      },
    },
    ...overrides,
  };
}

// T+0 by default -- paidAt and settledAt equal, matching MockPaymentProvider's
// own behaviour for a provider with no separate settlement estimate
// (prd-compliance 19). Tests asserting escrowReleaseAt against paidAt below
// rely on that equality; the dedicated test further down overrides settledAt
// to prove escrow anchors to it, not to paidAt.
const PROVIDER_PAID_AT = new Date('2026-09-20T10:00:00Z');

const PAID_EVENT = {
  provider: 'mock',
  providerEventId: 'evt-1',
  providerOrderId: 'donation-1',
  status: 'paid' as const,
  // Matches makePayment()'s default amount -- tests that want a mismatch
  // override this explicitly.
  grossAmount: 100_000,
  rawPayload: { order_id: 'donation-1', transaction_status: 'settlement' },
  paidAt: PROVIDER_PAID_AT,
  settledAt: PROVIDER_PAID_AT,
};

const REGISTRATION_PAID_EVENT = {
  provider: 'mock',
  providerEventId: 'evt-reg-1',
  providerOrderId: 'registration-1',
  status: 'paid' as const,
  // Matches makeRegistrationPayment()'s default amount.
  grossAmount: 250_000,
  rawPayload: { order_id: 'registration-1', transaction_status: 'settlement' },
  paidAt: PROVIDER_PAID_AT,
  settledAt: PROVIDER_PAID_AT,
};

describe('POST /api/webhooks/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
    mockWebhookEventUpdate.mockResolvedValue({});
    mockDonationFindUnique.mockResolvedValue({ anonymisedAt: null });
    mockNotificationCreateMany.mockResolvedValue({ count: 0 });
    mockNotificationCreate.mockResolvedValue({});
    mockSendReportingFailure.mockResolvedValue(true);
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


  describe('after an Admin switched the active provider (prd-compliance 39)', () => {
    const activeSetting = prisma.paymentProviderSetting.findFirst as unknown as Mock;

    function postTo(provider: string) {
      return POST(
        new NextRequest(`http://localhost:3000/api/webhooks/${provider}`, { method: 'POST', body: '{}' }),
        { params: Promise.resolve({ provider }) },
      );
    }

    it('still settles a Payment of provider B while the Admin setting names A, verified by B alone', async () => {
      activeSetting.mockResolvedValue({ provider: 'mock', methods: ['bank_transfer_va'] });
      mockGetPaymentProvider.mockReturnValue({
        parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, provider: 'sumopod' }),
      });
      mockPaymentFindUnique.mockResolvedValue(makePayment({ provider: 'sumopod' }));
      const { tx, ledgerRows } = makeTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      const response = await postTo('sumopod');

      expect(response.status).toBe(200);
      expect(mockGetPaymentProvider).toHaveBeenCalledWith('sumopod');
      expect(activeSetting).not.toHaveBeenCalled();
      expect(ledgerRows.every((r) => r.provider === 'sumopod')).toBe(true);
      expect(ledgerRows.length).toBeGreaterThan(0);
    });

    it('still refuses a provider mismatch: A\'s secret cannot settle B\'s Payment even if A is the active one', async () => {
      activeSetting.mockResolvedValue({ provider: 'mock', methods: ['bank_transfer_va'] });
      mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
      mockPaymentFindUnique.mockResolvedValue(makePayment({ provider: 'sumopod' }));

      const response = await postTo('mock');

      expect(response.status).toBe(200);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockWebhookEventUpdate).not.toHaveBeenCalled();
    });
  });

  it('stamps the provider on every leg of a settlement, so the Provider Balance can be read per provider', async () => {
    // CONTEXT.md, Provider Balance: "Tercatat sebagai akun buku besar
    // tersendiri per penyedia". The provider is a fact right here -- it is in
    // the path, and it is in the event -- so the settlement says which provider
    // this Gross landed at.
    //
    // This is what makes providerBalances (src/lib/money/ledger.ts) able to
    // answer "how much is at Sumopod" at all. Without it every settlement lands
    // in the unnamed bucket and the per-provider report has nothing to report.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, provider: 'sumopod' }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ provider: 'sumopod' }));
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(
      new NextRequest('http://localhost:3000/api/webhooks/sumopod', { method: 'POST', body: '{}' }),
      { params: Promise.resolve({ provider: 'sumopod' }) },
    );

    expect(response.status).toBe(200);
    // Every leg, not just the GATEWAY_CLEARING one: a transaction has one
    // provider, and stamping it per-leg is what lets a groupBy split the
    // Provider Balance without first re-deriving it from each leg's relations.
    expect(ledgerRows.length).toBeGreaterThan(0);
    expect(ledgerRows.every((r) => r.provider === 'sumopod')).toBe(true);
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'DEBIT', provider: 'sumopod' }),
    );
  });

  it('stamps the provider on a Trip Fee settlement too -- a Trip is not a Kind, but its money came from a provider', async () => {
    // ADR 0014 keeps a Volunteer Trip out of Campaign.Kind; it says nothing
    // about which provider took the money. A Trip Fee lands at the provider
    // exactly like a Donation does, so the pot has to grow by it.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...REGISTRATION_PAID_EVENT, provider: 'sumopod' }),
    });
    mockPaymentFindUnique.mockResolvedValue(makeRegistrationPayment({ provider: 'sumopod' }));
    mockConfirmRegistration.mockResolvedValue({ outcome: 'confirmed' });
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(
      new NextRequest('http://localhost:3000/api/webhooks/sumopod', { method: 'POST', body: '{}' }),
      { params: Promise.resolve({ provider: 'sumopod' }) },
    );

    expect(response.status).toBe(200);
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'DEBIT', provider: 'sumopod' }),
    );
  });

  it('asks the registry for the provider named in the URL, not a fixed one', async () => {
    // The route used to ignore its own path parameter and verify every
    // delivery as Midtrans, so /api/webhooks/sumopod was checked with the
    // wrong scheme and could never pass.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, provider: 'sumopod' }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ provider: 'sumopod' }));
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(
      new NextRequest('http://localhost:3000/api/webhooks/sumopod', { method: 'POST', body: '{}' }),
      { params: Promise.resolve({ provider: 'sumopod' }) },
    );

    expect(mockGetPaymentProvider).toHaveBeenCalledWith('sumopod');
  });

  it('answers 404 and writes nothing for a provider name it does not know', async () => {
    // Distinct from the 503 above: an unconfigured provider is an outage
    // worth retrying, an unknown one never becomes valid.
    mockGetPaymentProvider.mockImplementation(() => {
      throw new UnknownPaymentProviderError('stripe');
    });

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(mockWebhookEventCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('credits the campaign net of the provider fee the event reports', async () => {
    // The fee used to be hardcoded to 0, which credits the campaign money
    // the provider actually kept. Sumopod charges 0.7% + Rp300, so a
    // Rp100.000 donation arrives with Rp1.000 already gone.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, providerFee: 1_000 }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000 }),
    );
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 99_000 }),
    );
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'PROVIDER_FEE', direction: 'CREDIT', amount: 1_000 }),
    );
    const debits = ledgerRows.filter((r) => r.direction === 'DEBIT').reduce((sum, r) => sum + r.amount, 0);
    const credits = ledgerRows.filter((r) => r.direction === 'CREDIT').reduce((sum, r) => sum + r.amount, 0);
    expect(debits).toBe(credits);

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: expect.objectContaining({ providerFee: 1_000 }),
    });
  });

  it('posts the Platform Fee the Payment already froze, never recomputing it (prd-compliance 17)', async () => {
    // Platform Fee is resolved once, at POST /api/donations, and stored on
    // Payment.platformFee. Settlement must post exactly that number -- this
    // event reports no fee information of its own, so a webhook that
    // recomputed the fee here (e.g. from a rate that changed since the
    // Payment was created) would silently break the freeze.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, providerFee: 1_000 }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ platformFee: 2_500 }));
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'PLATFORM_FEE', direction: 'CREDIT', amount: 2_500 }),
    );
    expect(ledgerRows).toContainEqual(
      // Net of BOTH fees: 100_000 - 1_000 (provider) - 2_500 (platform) = 96_500.
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 96_500 }),
    );
    const debits = ledgerRows.filter((r) => r.direction === 'DEBIT').reduce((sum, r) => sum + r.amount, 0);
    const credits = ledgerRows.filter((r) => r.direction === 'CREDIT').reduce((sum, r) => sum + r.amount, 0);
    expect(debits).toBe(credits);
  });

  it('omits the Platform Fee leg when the Payment froze none (0)', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ platformFee: 0 }));
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(ledgerRows.some((r) => r.account === 'PLATFORM_FEE')).toBe(false);
  });

  it('still treats an absent provider fee as zero', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: expect.objectContaining({ providerFee: 0 }),
    });
  });

  it('answers 200 to an ignored event without recording it or touching a Payment', async () => {
    // Sumopod's dashboard "Save & Test" button sends payment.test. It is
    // genuinely signed and about nothing, so it must not be recorded, must
    // not be looked up, and above all must not fall into the failed branch
    // and mark a live donation failed.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({
        provider: 'sumopod',
        providerEventId: 'msg_test',
        providerOrderId: '',
        status: 'ignored',
        grossAmount: NaN,
        rawPayload: { event_type: 'payment.test' },
      }),
    });

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
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
      data: { processedAt: expect.any(Date), outcome: 'SETTLED' },
    });

    expect(mockNotificationCreateMany).toHaveBeenCalled();
  });

  it('leaves the abuse thresholds nothing to do for an ordinary Donation (prd-compliance 38)', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx, donationMarkers, auditMarkers, verificationRequests } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(donationMarkers).toEqual([]);
    expect(auditMarkers).toEqual([]);
    expect(verificationRequests).toEqual([]);
  });

  it('marks a large Donation and its Campaign in the settlement transaction, and never blocks the money (prd-compliance 38)', async () => {
    // A Rp600 juta Donation: above the single-Donation limit, above both
    // Campaign limits, and the Donation that carried the Campaign past them.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, grossAmount: 600_000_000 }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ amount: 600_000_000 }));
    const { tx, ledgerRows, donationMarkers, auditMarkers, verificationRequests } = makeTx();
    (tx.donation.findUnique as Mock).mockResolvedValue({
      id: 'donation-1',
      amount: 600_000_000,
      campaign: { id: 'campaign-1', collectedAmount: 600_000_000, isDemo: false },
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    // The money settled exactly as it would have: the ledger is balanced and
    // the Campaign is credited. Nothing about the Donation is held back.
    expect(response.status).toBe(200);
    const debits = ledgerRows.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    const credits = ledgerRows.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);
    expect(tx.campaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { collectedAmount: { increment: 600_000_000 } },
    });

    expect(donationMarkers).toEqual([
      expect.objectContaining({ donationId: 'donation-1', amount: 600_000_000, threshold: 50_000_000 }),
    ]);
    expect(auditMarkers).toEqual([
      expect.objectContaining({ campaignId: 'campaign-1', cumulativeGross: 600_000_000, threshold: 500_000_000 }),
    ]);
    expect(verificationRequests).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        kind: 'AMOUNT_REVIEW',
        submittedById: null,
        raisedByAmount: { cumulativeGross: 600_000_000, threshold: 100_000_000 },
      }),
    ]);
  });

  it('creates the Receipt inside the settlement transaction and emails it to a registered Donor, naming the Collecting Entity (prd-compliance 21)', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(tx.receipt.create).toHaveBeenCalledWith({
      data: {
        donationId: 'donation-1',
        token: 'tok-fixed',
        sentAt: expect.any(Date),
        lastSentAt: expect.any(Date),
      },
    });
    expect(mockSendReportingFailure).toHaveBeenCalledTimes(1);
    const [message, report] = mockSendReportingFailure.mock.calls[0];
    expect(message.to).toBe('donor@example.test');
    expect(message.text).toContain('Yayasan Contoh');
    expect(message.text).toContain('/receipt/tok-fixed');
    expect(report).toMatchObject({ mail: 'receipt', donationId: 'donation-1', paymentId: 'payment-1' });
  });

  it('opens the Receipt email with the beta notice for a Payment stamped sandbox, and not for a live one (ticket rilis-1-benda/92)', async () => {
    const receiptTextFor = async (overrides: Record<string, unknown>) => {
      mockSendReportingFailure.mockClear();
      mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
      mockPaymentFindUnique.mockResolvedValue(makePayment(overrides));
      const { tx } = makeTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      await POST(createRequest(), routeContext());
      return mockSendReportingFailure.mock.calls[0][0].text as string;
    };

    expect(await receiptTextFor({ sandbox: true })).toMatch(/Beta, tidak ada uang nyata/);
    expect(await receiptTextFor({ sandbox: false })).not.toMatch(/tidak ada uang nyata/i);
  });

  it('re-reads anonymisedAt right before sending, so a Donor anonymised after the Payment was loaded gets no Receipt email (ticket 36)', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    mockDonationFindUnique.mockResolvedValue({ anonymisedAt: new Date('2026-10-02T08:00:00.000Z') });
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(mockDonationFindUnique).toHaveBeenCalledWith({
      where: { id: 'donation-1' },
      select: { anonymisedAt: true },
    });
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('still answers 200, records the settlement and sends no Receipt when the anonymisedAt re-read throws (ticket 36)', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    mockDonationFindUnique.mockRejectedValue(new Error('connection lost'));
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(tx.payment.updateMany).toHaveBeenCalled();
    expect(tx.receipt.create).toHaveBeenCalled();
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('payment-1'), expect.any(Error));
    expect(JSON.stringify(error.mock.calls)).not.toContain('donor@example.test');
  });

  it('emails the Receipt to a Guest Donor at their sealed guest email when there is no account', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(
      makePayment({
        donation: {
          id: 'donation-1',
          donorId: null,
          donor: null,
          guestName: 'Guest Test',
          ...sealDonationGuestEmail('guest@example.test'),
          campaign: {
            id: 'campaign-1',
            title: 'Test Campaign',
            creatorId: 'creator-1',
            collectedAmount: 0,
            targetAmount: 1_000_000,
            collectingEntity: { id: 'org-1', name: 'Yayasan Contoh' },
          },
        },
      }),
    );
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(mockSendReportingFailure).toHaveBeenCalledTimes(1);
    const [message] = mockSendReportingFailure.mock.calls[0];
    expect(message.to).toBe('guest@example.test');
    expect(message.text).toContain('Guest Test');
  });

  it('does not create a Receipt for a Trip Fee (Registration) settlement', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makeRegistrationPayment());
    mockConfirmRegistration.mockResolvedValue({ outcome: 'confirmed' });
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('creates an Akad Wakaf alongside the Receipt for a `wakaf` Campaign, naming the Wakif, amount, purpose and nazhir, and emails it in the same delivery as the Receipt (CONTEXT.md, Akad Wakaf; ticket 22)', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(
      makePayment({
        donation: {
          id: 'donation-1',
          donorId: 'donor-1',
          guestEmailCiphertext: null,
          guestEmailKeyId: null,
          guestName: null,
          donor: { id: 'donor-1', name: 'Wakif Test', ...sealUserEmail('donor@example.test') },
          campaign: {
            id: 'campaign-1',
            title: 'Wakaf Pembangunan Masjid Al-Ikhlas',
            kind: 'WAKAF',
            creatorId: 'creator-1',
            collectedAmount: 0,
            targetAmount: 1_000_000,
            collectingEntity: { id: 'org-1', name: 'Yayasan Contoh' },
          },
        },
      }),
    );
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(tx.akadWakaf.create).toHaveBeenCalledWith({
      data: { donationId: 'donation-1', token: 'akad-tok-fixed' },
    });
    expect(mockSendReportingFailure).toHaveBeenCalledTimes(1);
    const [message] = mockSendReportingFailure.mock.calls[0];
    // Same delivery as the Receipt, not a second email.
    expect(message.to).toBe('donor@example.test');
    expect(message.text).toContain('/receipt/tok-fixed');
    expect(message.text).toContain('/akad-wakaf/akad-tok-fixed');
    expect(message.text).toContain('Wakif Test');
    expect(message.text).toContain(formatRupiah(100_000));
    expect(message.text).toContain('Wakaf Pembangunan Masjid Al-Ikhlas');
    expect(message.text).toContain('Yayasan Contoh');
  });

  it('does not create an Akad Wakaf for a non-`wakaf` Campaign', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(tx.akadWakaf.create).not.toHaveBeenCalled();
    const [message] = mockSendReportingFailure.mock.calls[0];
    expect(message.text).not.toContain('/akad-wakaf/');
  });

  it('does not create an Akad Wakaf for a Trip Fee (Registration) settlement', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makeRegistrationPayment());
    mockConfirmRegistration.mockResolvedValue({ outcome: 'confirmed' });
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(tx.akadWakaf.create).not.toHaveBeenCalled();
  });

  it('settles the Donation and logs instead of sending when the Campaign has no Collecting Entity, without failing the webhook', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(
      makePayment({
        donation: {
          id: 'donation-1',
          donorId: 'donor-1',
          guestEmailCiphertext: null,
          guestEmailKeyId: null,
          guestName: null,
          donor: { id: 'donor-1', name: 'Donor Test', ...sealUserEmail('donor@example.test') },
          campaign: {
            id: 'campaign-1',
            title: 'Test Campaign',
            creatorId: 'creator-1',
            collectedAmount: 0,
            targetAmount: 1_000_000,
            collectingEntity: null,
          },
        },
      }),
    );
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(tx.receipt.create).toHaveBeenCalled();
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no Collecting Entity'));
  });

  it('anchors the release to the hold length THIS Payment froze, not the live default (prd-compliance 18)', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    // A disaster Campaign whose Payment froze a shortened 2-day hold. Even
    // though ESCROW_HOLD_DAYS (the live default) is still 7, this Payment's
    // release must reflect the 2 days it actually promised.
    mockPaymentFindUnique.mockResolvedValue(makePayment({ escrowHoldDays: 2 }));
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    const paymentUpdateData = (tx.payment.updateMany as Mock).mock.calls[0][0].data;
    expect(paymentUpdateData.escrowReleaseAt.getTime() - paymentUpdateData.paidAt.getTime()).toBe(
      2 * 24 * 60 * 60 * 1000,
    );
  });

  it('anchors the release to the provider settlement estimate, not to paidAt or receipt time (prd-compliance 19)', async () => {
    // Sumopod's QRIS settles T+2: paidAt is when the donor paid, settledAt
    // is two days later. If escrow anchored to paidAt (or, worse, to
    // whenever this webhook happened to arrive) instead, the hold would
    // release two days before the provider's own estimate says the money
    // clears.
    const paidAt = new Date('2026-09-20T10:00:00Z');
    const settledAt = new Date('2026-09-22T10:00:00Z');
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, paidAt, settledAt }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    const paymentUpdateData = (tx.payment.updateMany as Mock).mock.calls[0][0].data;
    expect(paymentUpdateData.paidAt).toEqual(paidAt);
    expect(paymentUpdateData.settledAt).toEqual(settledAt);
    expect(paymentUpdateData.escrowReleaseAt).toEqual(
      new Date(settledAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    );
  });

  // ADR 0004: reaching the target does not close a Campaign; only the
  // Fundraiser or an Admin marks it COMPLETED. And because a Settlement is
  // accepted whatever the Campaign's status (PRD §7.2), a late one must not
  // overwrite a Suspended, Cancelled, Completed or Expired status either.
  it.each([
    ['active', 'ACTIVE', 900_000],
    ['active', 'ACTIVE', 950_000],
    ['suspended', 'SUSPENDED', 950_000],
    ['cancelled', 'CANCELLED', 950_000],
    ['completed', 'COMPLETED', 950_000],
    ['expired', 'EXPIRED', 950_000],
  ] as const)(
    'records a settlement that reaches the target without changing the campaign status (%s / %s, %s collected before)',
    async (status, lifecycleStatus, collectedAmount) => {
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
              status,
              lifecycleStatus,
              collectedAmount,
              targetAmount: 1_000_000,
            },
          },
        }),
      );
      const { tx, ledgerRows } = makeTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      const response = await POST(createRequest(), routeContext());

      expect(response.status).toBe(200);
      expect(tx.campaign.update).toHaveBeenCalledTimes(1);
      expect(tx.campaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: { collectedAmount: { increment: 100_000 } },
      });
      // The money is still recorded in full.
      expect(ledgerRows).toContainEqual(
        expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000 }),
      );
    },
  );

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
      data: { processedAt: expect.any(Date), outcome: 'AMOUNT_MISMATCH' },
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
    // Money with no Payment to land on: labelled so an Admin can find it.
    expect(mockWebhookEventUpdate).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date), outcome: 'UNKNOWN_PAYMENT' },
    });
  });

  it.each(['expired', 'failed'] as const)(
    'labels a %s event naming no known Payment IGNORED_TERMINAL, not UNKNOWN_PAYMENT: no money is missing',
    async (status) => {
      mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, status }) });
      mockPaymentFindUnique.mockResolvedValue(null);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await POST(createRequest(), routeContext());

      expect(response.status).toBe(200);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockWebhookEventUpdate).toHaveBeenCalledWith({
        where: { id: 'we-1' },
        data: { processedAt: expect.any(Date), outcome: 'IGNORED_TERMINAL' },
      });
      consoleErrorSpy.mockRestore();
    },
  );

  it('logs an unexpected failure without the raw Error object or any email in it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
      mockWebhookEventCreate.mockRejectedValue(new Error('insert failed for donor@example.com'));

      const response = await POST(createRequest(), routeContext());

      expect(response.status).toBe(500);
      expect(spy).toHaveBeenCalled();
      const args = spy.mock.calls.flat();
      expect(args.some((a) => a instanceof Error)).toBe(false);
      expect(args.some((a) => typeof a === 'string' && a.includes('@'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
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
      data: { processedAt: expect.any(Date), outcome: 'SETTLED' },
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
      data: { processedAt: expect.any(Date), outcome: 'LOST_RACE' },
    });
  });

  it('does not double-settle a Donation when a SIBLING Payment (a retry) wins the race first: the DB partial unique index refuses the second PAID (prd-compliance 18)', async () => {
    // Two DIFFERENT Payment rows for the SAME Donation (a retry after the
    // first attempt looked abandoned) both still PENDING when their events
    // arrive. Each individually passes the id+PENDING guard -- the
    // Payment_donationId_paid_key partial unique index is what actually
    // stops both from reaching PAID, by rejecting the loser's UPDATE.
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
    const tx = {
      payment: {
        updateMany: vi.fn().mockRejectedValue(
          Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
            meta: { target: ['Payment_donationId_paid_key'] },
          }),
        ),
      },
      donation: { update: vi.fn() },
      campaign: { update: vi.fn() },
      webhookEvent: { update: vi.fn() },
      ledgerEntry: { count: vi.fn(), createMany: vi.fn() },
    };
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    mockWebhookEventUpdate.mockResolvedValue({});

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    // Nothing inside the aborted transaction ran past the failed update --
    // Postgres itself would refuse any further statement on that connection.
    expect(tx.donation.update).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(tx.webhookEvent.update).not.toHaveBeenCalled();
    // The bookkeeping happens on a fresh connection instead, outside the
    // rolled-back transaction.
    expect(mockWebhookEventUpdate).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date), outcome: 'SIBLING_ALREADY_PAID' },
    });
  });

  it('answers a provider mismatch like an unknown providerRef: 200, recorded but NOT processed, Payment untouched (ticket 51)', async () => {
    // Signed and genuine for /api/webhooks/mock, but the Payment it names was
    // charged through sumopod. Whoever holds one provider's secret must not be
    // able to settle another provider's charge.
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ provider: 'sumopod' }));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockWebhookEventCreate).toHaveBeenCalledTimes(1);
    // Not stamped processed: (provider, providerEventId) is the dedupe key, so
    // a processed mismatch would make a later genuine event with the same id a replay.
    expect(mockWebhookEventUpdate).not.toHaveBeenCalled();
    expect(mockConfirmRegistration).not.toHaveBeenCalled();
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('a provider mismatch does not make a later genuine event with the same id a replay: it is processed (ticket 51)', async () => {
    // First delivery: mismatch. Row created, left unprocessed.
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ provider: 'sumopod' }));
    expect((await POST(createRequest(), routeContext())).status).toBe(200);
    expect(mockWebhookEventUpdate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();

    // Second delivery, same (provider, providerEventId): the unique constraint
    // fires and the existing row is unprocessed, so it is not a replay.
    mockWebhookEventCreate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));
    mockWebhookEventFindUniqueOrThrow.mockResolvedValue({ id: 'we-1', processedAt: null });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ provider: 'mock' }));
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('answers a provider mismatch on a Trip Fee Payment with 200 too', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue(REGISTRATION_PAID_EVENT),
    });
    mockPaymentFindUnique.mockResolvedValue(makeRegistrationPayment({ provider: 'sumopod' }));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockConfirmRegistration).not.toHaveBeenCalled();
  });

  it('handles a provider mismatch before the terminal-status early exit, so it is never stamped processed as a replay', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ provider: 'sumopod', status: 'PAID' }));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockWebhookEventUpdate).not.toHaveBeenCalled();
  });

  it('rejects an event for a Payment already in a terminal status, without reprocessing it', async () => {
    mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ status: 'PAID' }));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockWebhookEventUpdate).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date), outcome: 'IGNORED_TERMINAL' },
    });
  });

  it('labels a non-paid event landing on an EXPIRED Payment IGNORED_TERMINAL and does not settle it', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, status: 'failed' as const }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment({ status: 'EXPIRED' }));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockWebhookEventUpdate).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date), outcome: 'IGNORED_TERMINAL' },
    });
    consoleErrorSpy.mockRestore();
  });

  it.each([
    { from: 'EXPIRED', outcome: 'PAID_AFTER_EXPIRED' },
    { from: 'FAILED', outcome: 'PAID_AFTER_FAILED' },
  ] as const)(
    'settles a paid event for a $from Payment, guarding the update on that status and labelling it $outcome',
    async ({ from, outcome }) => {
      mockGetPaymentProvider.mockReturnValue({ parseWebhook: vi.fn().mockResolvedValue(PAID_EVENT) });
      mockPaymentFindUnique.mockResolvedValue(makePayment({ status: from }));
      const { tx, ledgerRows } = makeTx();
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      const response = await POST(createRequest(), routeContext());

      expect(response.status).toBe(200);
      // The race guard keys on the status the Payment was read in, not PENDING.
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: from },
        data: expect.objectContaining({ status: 'PAID' }),
      });
      expect(ledgerRows.length).toBeGreaterThan(0);
      expect(tx.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'we-1' },
        data: { processedAt: expect.any(Date), outcome },
      });
    },
  );
});

describe('POST /api/webhooks/[provider] -- registration-linked (Trip Fee) payment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
    mockWebhookEventUpdate.mockResolvedValue({});
    mockNotificationCreateMany.mockResolvedValue({ count: 0 });
    mockNotificationCreate.mockResolvedValue({});
    mockConfirmRegistration.mockResolvedValue({ outcome: 'confirmed' });
    mockExpireRegistrationHold.mockResolvedValue(undefined);
    mockRefundLateSettlement.mockResolvedValue({ refund: { id: 'refund-1' } });
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue(REGISTRATION_PAID_EVENT),
    });
    mockPaymentFindUnique.mockResolvedValue(makeRegistrationPayment());
  });

  it('paid: confirms the Registration through the module inside the settlement, posts escrow legs for the Trip, notifies the Volunteer, does not touch Campaign/Donation tables', async () => {
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);

    expect(mockConfirmRegistration).toHaveBeenCalledWith(tx, { registrationId: 'registration-1' });

    // Campaign/Donation tables are never written for a Trip Fee settlement.
    expect(tx.donation.update).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();

    // Settlement lands in ESCROW_HOLD, scoped to the trip -- same as a
    // Campaign-linked settlement, just with volunteerTripId instead of
    // campaignId. TRIP_BALANCE is only credited later, when the hold matures
    // (releaseMaturedEscrow).
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({
        account: 'ESCROW_HOLD',
        direction: 'CREDIT',
        amount: 250_000,
        volunteerTripId: 'trip-1',
      }),
    );
    expect(ledgerRows.some((r) => r.account === 'CAMPAIGN_BALANCE' || r.account === 'TRIP_BALANCE')).toBe(false);

    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'registration_confirmed',
        userId: 'volunteer-1',
        link: '/volunteer-trip/bersih-pantai',
      }),
    });
    expect(mockNotificationCreateMany).not.toHaveBeenCalled();
    expect(mockRefundLateSettlement).not.toHaveBeenCalled();

    expect(tx.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date), outcome: 'SETTLED' },
    });
  });

  it('paid: still posts the ledger legs when the hold had lapsed, does not notify, and has the module refund it in full once the settlement has committed', async () => {
    // A hold can expire without its Payment being touched, and the Payment
    // can stay PENDING for up to VA_EXPIRY_MS after the 30-minute hold
    // window closed. If the charge clears in that window, the money
    // genuinely arrived at the provider -- settlement must not be refused --
    // but there is no seat to confirm: the Volunteer must not be told
    // registration succeeded, and is refunded instead (ticket 40).
    mockConfirmRegistration.mockResolvedValue({ outcome: 'lapsed' });
    const { tx, ledgerRows } = makeTx();
    const order: string[] = [];
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const result = await cb(tx);
      order.push('settlement committed');
      return result;
    });
    mockRefundLateSettlement.mockImplementation(async () => {
      order.push('late-settlement refund');
      return { refund: { id: 'refund-1' } };
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'PAID' }),
    });
    expect(ledgerRows).toContainEqual(
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 250_000, volunteerTripId: 'trip-1' }),
    );
    expect(mockNotificationCreate).not.toHaveBeenCalled();
    expect(mockRefundLateSettlement).toHaveBeenCalledTimes(1);
    expect(mockRefundLateSettlement).toHaveBeenCalledWith(prisma, { registrationId: 'registration-1' });
    expect(order).toEqual(['settlement committed', 'late-settlement refund']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('auto-refunding'));

    consoleErrorSpy.mockRestore();
  });

  it('paid: a second delivery of the same settlement neither confirms nor refunds again', async () => {
    mockConfirmRegistration.mockResolvedValue({ outcome: 'lapsed' });
    // The loser of the PENDING -> PAID race: a real database returns count 0.
    const { tx } = makeTx({ paymentUpdateManyCount: 0 });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockConfirmRegistration).not.toHaveBeenCalled();
    expect(mockRefundLateSettlement).not.toHaveBeenCalled();
  });

  it('paid: has the module refund a Registration cancelled before the charge cleared, once the settlement has committed', async () => {
    mockConfirmRegistration.mockResolvedValue({ outcome: 'cancelled' });
    const { tx, ledgerRows } = makeTx();
    const order: string[] = [];
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const result = await cb(tx);
      order.push('settlement committed');
      return result;
    });
    mockRefundLateSettlement.mockImplementation(async () => {
      order.push('late-settlement refund');
      return { refund: { id: 'refund-1' } };
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    // The money genuinely arrived -- settlement and the ledger legs still post.
    expect(ledgerRows.some((r) => r.account === 'ESCROW_HOLD')).toBe(true);
    // No false-success notification -- there is no seat.
    expect(mockNotificationCreate).not.toHaveBeenCalled();
    // In its own transaction, after the settlement's, never nested in it.
    expect(mockRefundLateSettlement).toHaveBeenCalledTimes(1);
    expect(mockRefundLateSettlement).toHaveBeenCalledWith(prisma, { registrationId: 'registration-1' });
    expect(order).toEqual(['settlement committed', 'late-settlement refund']);
    consoleErrorSpy.mockRestore();
  });

  it('paid: logs and still answers 200 when the automatic refund itself fails', async () => {
    mockConfirmRegistration.mockResolvedValue({ outcome: 'cancelled' });
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    mockRefundLateSettlement.mockRejectedValue(new Error('database exploded'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('failed to auto-refund payment payment-1'));
    // Never the raw error object: provider errors can carry PII or tokens.
    for (const call of consoleErrorSpy.mock.calls) {
      expect(call.some((arg) => arg instanceof Error)).toBe(false);
    }
    // The failure leaves a mark an Admin can search; the response stays 200.
    expect(mockWebhookEventUpdate).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { outcome: 'LATE_SETTLEMENT_REFUND_FAILED' },
    });
    consoleErrorSpy.mockRestore();
  });

  it('paid: still answers 200 when marking the failed refund fails too', async () => {
    mockConfirmRegistration.mockResolvedValue({ outcome: 'cancelled' });
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    mockRefundLateSettlement.mockRejectedValue(new Error('database exploded'));
    mockWebhookEventUpdate.mockRejectedValue(new Error('still down'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    consoleErrorSpy.mockRestore();
  });

  it('failed/expired: has the module expire the hold inside the same transaction, posts nothing, does not touch Campaign/Donation tables', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({
        ...REGISTRATION_PAID_EVENT,
        status: 'expired',
        providerEventId: 'evt-reg-2',
      }),
    });
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    });
    expect(mockExpireRegistrationHold).toHaveBeenCalledWith(tx, { registrationId: 'registration-1' });
    expect(mockConfirmRegistration).not.toHaveBeenCalled();
    expect(tx.donation.update).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it('failed/expired: leaves the Registration alone when another delivery already moved the Payment', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...REGISTRATION_PAID_EVENT, status: 'expired', providerEventId: 'evt-reg-3' }),
    });
    const { tx } = makeTx({ paymentUpdateManyCount: 0 });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(mockExpireRegistrationHold).not.toHaveBeenCalled();
    expect(tx.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { processedAt: expect.any(Date), outcome: 'LOST_RACE' },
    });
  });

  it('no Platform Fee leg is ever posted against a Trip Fee settlement', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...REGISTRATION_PAID_EVENT, providerFee: 2_500 }),
    });
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    await POST(createRequest(), routeContext());

    expect(ledgerRows.some((r) => r.account === 'PLATFORM_FEE')).toBe(false);
    const debits = ledgerRows.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    const credits = ledgerRows.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);
  });
});

// Ticket 51. The adapter's own gate is covered in src/lib/payments/index.test.ts;
// this is the route seam: with the REAL registry behind it (not the stubbed
// getPaymentProvider the other tests use), a mock webhook in production
// without the opt-in must be refused before anything is written.
describe('POST /api/webhooks/mock in production (ticket 51)', () => {
  const ENV_KEYS = ['NODE_ENV', 'ALLOW_MOCK_PAYMENT_PROVIDER', 'MOCK_MIDTRANS_SERVER_KEY'] as const;
  const SERVER_KEY = 'test-mock-server-key';
  let saved: Record<string, string | undefined>;

  async function signedRequest(): Promise<NextRequest> {
    const body = await new MockPaymentProvider({ serverKey: SERVER_KEY }).simulateWebhookPayload(
      'order-unknown',
      100_000,
      'settlement',
      'evt-prod-gate',
    );
    return createRequest(body);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    setEnv('MOCK_MIDTRANS_SERVER_KEY', SERVER_KEY);
    setEnv('NODE_ENV', 'production');
    setEnv('ALLOW_MOCK_PAYMENT_PROVIDER', undefined);
    const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
    mockGetPaymentProvider.mockImplementation(actual.getPaymentProvider);
    mockWebhookEventCreate.mockResolvedValue({ id: 'we-1' });
    mockWebhookEventUpdate.mockResolvedValue({});
    mockPaymentFindUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) setEnv(k, saved[k]);
  });

  it('answers 503 and writes nothing, even for a validly signed event', async () => {
    const response = await POST(await signedRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(mockWebhookEventCreate).not.toHaveBeenCalled();
    expect(mockWebhookEventUpdate).not.toHaveBeenCalled();
    expect(mockPaymentFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('still answers 503 when ALLOW_MOCK_PAYMENT_PROVIDER is anything but exactly "true"', async () => {
    for (const value of ['1', 'yes', 'TRUE', ' true']) {
      setEnv('ALLOW_MOCK_PAYMENT_PROVIDER', value);
      const response = await POST(await signedRequest(), routeContext());
      expect(response.status).toBe(503);
    }
    expect(mockWebhookEventCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('runs as usual when ALLOW_MOCK_PAYMENT_PROVIDER is "true": the event is recorded and the Payment looked up', async () => {
    setEnv('ALLOW_MOCK_PAYMENT_PROVIDER', 'true');

    const response = await POST(await signedRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockWebhookEventCreate).toHaveBeenCalledTimes(1);
    expect(mockPaymentFindUnique).toHaveBeenCalledTimes(1);
  });
});
