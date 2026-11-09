import { NextRequest, NextResponse } from 'next/server';
import { merchantFromUrlSegment, UnknownMerchantEntityError } from '@/lib/payments/merchant';
import { handleProviderWebhook } from '../handle-webhook';

/**
 * POST /api/webhooks/[provider]/[merchant]: one webhook URL per Merchant Account
 * (ADR 0027), e.g. /api/webhooks/sumopod/yayasan and
 * /api/webhooks/sumopod/badan-usaha. Each is verified with its own merchant's
 * secret, and a delivery verified for one merchant can never settle a Payment
 * of the other. An unknown merchant segment is a 404 (it never becomes valid),
 * answered before the body is read.
 *
 * Never gated by the donation switch or maintenance mode, like the route it
 * shares a handler with: a payment already made must always be able to settle.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string; merchant: string }> },
) {
  const { provider, merchant: segment } = await params;
  let merchant;
  try {
    merchant = merchantFromUrlSegment(segment);
  } catch (err) {
    if (err instanceof UnknownMerchantEntityError) {
      console.error(`[webhooks/${provider}] rejected: no such merchant`);
      return NextResponse.json({ error: 'Merchant tidak dikenal' }, { status: 404 });
    }
    throw err;
  }
  return handleProviderWebhook(request, provider, merchant);
}
