import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

/**
 * A Donor -- registered or Guest -- can ask for their Receipt again
 * (CONTEXT.md, Receipt; prd-compliance 21). The token in the URL is the only
 * gate (a Guest Donor has no account to authenticate with), so this route
 * enforces its own cooldown rather than trusting a caller not to hammer it.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    receipt: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/mail', () => ({
  sendReportingFailure: vi.fn().mockResolvedValue(true),
}));

import { sealDonationGuestEmail, sealUserEmail } from '@/lib/contact-fields';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';

const mockFindUnique = prisma.receipt.findUnique as unknown as Mock;
const mockUpdate = prisma.receipt.update as unknown as Mock;
const mockSendReportingFailure = sendReportingFailure as unknown as Mock;

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/receipts/tok-1/resend', { method: 'POST' });
}

function routeContext(token = 'tok-1') {
  return { params: Promise.resolve({ token }) };
}

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    donationId: 'donation-1',
    token: 'tok-1',
    sentAt: new Date('2026-09-26T10:00:00Z'),
    lastSentAt: new Date('2026-09-26T10:00:00Z'),
    resendCount: 0,
    donation: {
      id: 'donation-1',
      amount: 100_000,
      donorId: 'donor-1',
      guestName: null,
      // Sealed, not plaintext (ADR 0012): the route decrypts to address it.
      guestEmailCiphertext: null,
      guestEmailKeyId: null,
      donor: { id: 'donor-1', name: 'Donor Test', ...sealUserEmail('donor@example.test') },
      createdAt: new Date('2026-09-26T09:55:00Z'),
      campaign: {
        id: 'campaign-1',
        title: 'Test Campaign',
        collectingEntity: { id: 'org-1', name: 'Yayasan Contoh' },
      },
    },
    ...overrides,
  };
}

describe('POST /api/receipts/[token]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendReportingFailure.mockResolvedValue(true);
    mockUpdate.mockResolvedValue({});
  });

  it('answers 404 for a token that names no Receipt', async () => {
    mockFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('resends the email, bumps resendCount, and answers 200 once the cooldown has passed', async () => {
    mockFindUnique.mockResolvedValue(
      makeReceipt({ lastSentAt: new Date('2026-09-26T09:00:00Z'), resendCount: 1 }),
    );

    const response = await POST(
      createRequest(),
      routeContext(),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sent).toBe(true);
    expect(mockSendReportingFailure).toHaveBeenCalledTimes(1);
    const [message] = mockSendReportingFailure.mock.calls[0];
    expect(message.to).toBe('donor@example.test');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'receipt-1' },
      data: { lastSentAt: expect.any(Date), resendCount: 2 },
    });
  });

  it('answers 429 without sending again inside the cooldown window', async () => {
    mockFindUnique.mockResolvedValue(makeReceipt({ lastSentAt: new Date() }));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 502 and does not bump resendCount when the send is rejected or unconfigured', async () => {
    mockFindUnique.mockResolvedValue(makeReceipt({ lastSentAt: new Date('2026-09-26T09:00:00Z') }));
    mockSendReportingFailure.mockResolvedValue(false);

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.sent).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('sends to the Guest Donor at their sealed guest email when there is no account', async () => {
    mockFindUnique.mockResolvedValue(
      makeReceipt({
        lastSentAt: new Date('2026-09-26T09:00:00Z'),
        donation: {
          id: 'donation-1',
          amount: 100_000,
          donorId: null,
          donor: null,
          guestName: 'Guest Test',
          ...sealDonationGuestEmail('guest@example.test'),
          createdAt: new Date('2026-09-26T09:55:00Z'),
          campaign: {
            id: 'campaign-1',
            title: 'Test Campaign',
            collectingEntity: { id: 'org-1', name: 'Yayasan Contoh' },
          },
        },
      }),
    );

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    const [message] = mockSendReportingFailure.mock.calls[0];
    expect(message.to).toBe('guest@example.test');
  });

  it('answers 500 without sending when the Campaign has no Collecting Entity', async () => {
    mockFindUnique.mockResolvedValue(
      makeReceipt({
        lastSentAt: new Date('2026-09-26T09:00:00Z'),
        donation: {
          ...makeReceipt().donation,
          campaign: { id: 'campaign-1', title: 'Test Campaign', collectingEntity: null },
        },
      }),
    );

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });
});
