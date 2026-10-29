import { NextRequest, NextResponse } from 'next/server';
import { clientAddress } from '@/lib/client-ip';
import { retryDonationPayment } from '@/lib/donation-retry';
import { verifyPaymentResultToken } from '@/lib/money/payment-result-token';

/**
 * "Coba bayar lagi" from the payment result page (ticket 98), addressed by that
 * page's signed token rather than the Donation id, so the page never hands the
 * id (which works forever) to whoever holds a link that expires.
 *
 * The token is the whole credential, for a Guest Donation and an account's
 * alike: it is what the provider returned the Donor with, and a retry only
 * opens a new charge on the same Donation, which moves no money until someone
 * pays it. An invalid or expired token is the same 404 as a missing Donation.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const donationId = verifyPaymentResultToken(token, Date.now());
    if (!donationId) return NextResponse.json({ error: 'Donasi tidak ditemukan' }, { status: 404 });

    const result = await retryDonationPayment({
      donationId,
      clientAddress: clientAddress(request.headers),
      authorize: async () => true,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error retrying donation payment:', error);
    return NextResponse.json({ error: 'Gagal memproses pembayaran ulang' }, { status: 500 });
  }
}
