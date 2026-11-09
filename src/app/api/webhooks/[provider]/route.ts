import { NextRequest } from 'next/server';
import { handleProviderWebhook } from './handle-webhook';

/**
 * POST /api/webhooks/[provider]: the webhook URL registered at the provider
 * today. Since ADR 0027 it is the YAYASAN merchant's URL, verified with the
 * YAYASAN merchant's webhook secret (the old SUMOPOD_WEBHOOK_SECRET when no
 * SUMOPOD_YAYASAN_WEBHOOK_SECRET is set), so a deployment that registered this
 * URL before the BADAN_USAHA merchant existed keeps working unchanged. The
 * BADAN_USAHA merchant's deliveries go to /api/webhooks/[provider]/badan-usaha.
 *
 * Everything the handler does, and why, is documented on it
 * (./handle-webhook.ts).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  return handleProviderWebhook(request, provider, 'YAYASAN');
}
