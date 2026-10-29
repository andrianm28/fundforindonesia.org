import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { clientAddress } from '@/lib/client-ip';
import { retryDonationPayment } from '@/lib/donation-retry';

/**
 * A Donor retries payment on a Donation whose last attempt did not go through,
 * addressed by the Donation's id (src/lib/donation-retry.ts holds the
 * whole rule, shared with the payment result page's token route).
 *
 * A signed-in Donor's own Donation only: their session must match, so a leaked
 * id alone cannot be used to poke at somebody else's Donation.
 *
 * A Guest Donation is not retried here at all (PR #273 review, S2). The id is
 * the provider's order id and is readable inside the payment result token, so
 * as a credential it would outlive every link it was ever seen in. A Guest Donor
 * retries from the payment result page, whose route takes the signed token,
 * which expires (POST /api/donations/result/[token]/retry).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await retryDonationPayment({
      donationId: id,
      clientAddress: clientAddress(request.headers),
      authorize: async ({ donorId }) => {
        if (!donorId) return false;
        const session = await getServerSession();
        return session?.user?.id === donorId;
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error retrying donation payment:', error);
    return NextResponse.json({ error: 'Gagal memproses pembayaran ulang' }, { status: 500 });
  }
}
