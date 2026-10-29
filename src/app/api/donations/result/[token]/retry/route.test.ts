import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The payment result page's "Coba bayar lagi" (ticket 98): addressed by the
 * page's signed token, which is the whole credential. The retry rule itself is
 * donation-retry.ts's and is pinned by the [id] route's tests.
 */

vi.mock('@/lib/donation-retry', () => ({ retryDonationPayment: vi.fn() }));

import { POST } from './route';
import { retryDonationPayment } from '@/lib/donation-retry';
import { signPaymentResultToken } from '@/lib/money/payment-result-token';

const mockRetry = retryDonationPayment as unknown as Mock;

function post(token: string) {
  return POST(
    new NextRequest(`http://localhost:3000/api/donations/result/${token}/retry`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRetry.mockResolvedValue({ status: 201, body: { paymentInstructions: { redirectUrl: 'https://pay.example/x' } } });
});

describe('POST /api/donations/result/[token]/retry', () => {
  it('retries exactly the Donation the token was signed for, whoever owns it', async () => {
    const response = await post(signPaymentResultToken('donation-1', Date.now()));

    expect(response.status).toBe(201);
    expect(mockRetry).toHaveBeenCalledWith(
      expect.objectContaining({ donationId: 'donation-1', clientAddress: '203.0.113.7' }),
    );
    const { authorize } = mockRetry.mock.calls[0][0];
    expect(await authorize({ donorId: null })).toBe(true);
    expect(await authorize({ donorId: 'owner-1' })).toBe(true);
  });

  it('is a 404 for a bare Donation id or a tampered token, without touching the Donation', async () => {
    const token = signPaymentResultToken('donation-1', Date.now());
    const tampered = `${token[0] === 'A' ? 'B' : 'A'}${token.slice(1)}`;
    for (const bad of ['donation-1', `${token}x`, tampered]) {
      const response = await post(bad);
      expect(response.status).toBe(404);
    }
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('is a 404 once the token has expired', async () => {
    const response = await post(signPaymentResultToken('donation-1', Date.now() - 365 * 24 * 60 * 60 * 1000));

    expect(response.status).toBe(404);
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('passes the retry rule\'s answer through unchanged', async () => {
    mockRetry.mockResolvedValue({ status: 409, body: { error: 'Pembayaran ulang untuk donasi ini sedang diproses. Tunggu sebentar.' } });

    const response = await post(signPaymentResultToken('donation-1', Date.now()));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('Pembayaran ulang untuk donasi ini sedang diproses. Tunggu sebentar.');
  });
});
