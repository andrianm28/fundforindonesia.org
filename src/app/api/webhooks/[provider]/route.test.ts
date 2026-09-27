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

const mockConfirmRegistration = confirmRegistration as unknown as Mock;
const mockExpireRegistrationHold = expireRegistrationHold as unknown as Mock;
const mockRefundLateSettlement = refundLateSettlement as unknown as Mock;
const mockWebhookEventCreate = prisma.webhookEvent.create as unknown as Mock;
const mockWebhookEventUpdate = prisma.webhookEvent.update as unknown as Mock;
const mockWebhookEventFindUniqueOrThrow = prisma.webhookEvent.findUniqueOrThrow as unknown as Mock;
const mockPaymentFindUnique = prisma.payment.findUnique as unknown as Mock;
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
  return { tx, ledgerRows };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
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


  it('asks the registry for the provider named in the URL, not a fixed one', async () => {
    // The route used to ignore its own path parameter and verify every
    // delivery as Midtrans, so /api/webhooks/sumopod was checked with the
    // wrong scheme and could never pass.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue({ ...PAID_EVENT, provider: 'sumopod' }),
    });
    mockPaymentFindUnique.mockResolvedValue(makePayment());
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
      data: { processedAt: expect.any(Date) },
    });

    expect(mockNotificationCreateMany).toHaveBeenCalled();
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
      data: { processedAt: expect.any(Date) },
    });
  });

  it('paid: still posts the ledger legs and settles the Payment when the hold had lapsed, but neither notifies nor refunds', async () => {
    // A hold can expire without its Payment being touched, and the Payment
    // can stay PENDING for up to VA_EXPIRY_MS after the 30-minute hold
    // window closed. If the charge clears in that window, the money
    // genuinely arrived at the provider -- settlement must not be refused --
    // but there is no seat left to confirm, so the Volunteer must not be
    // told registration succeeded.
    mockConfirmRegistration.mockResolvedValue({ outcome: 'lapsed' });
    const { tx, ledgerRows } = makeTx();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
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
    expect(mockRefundLateSettlement).not.toHaveBeenCalled();
    // Logged for manual review: money collected, no seat confirmed.
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('registration-1'));

    consoleErrorSpy.mockRestore();
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
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed to auto-refund payment payment-1'),
      expect.any(Error),
    );
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
