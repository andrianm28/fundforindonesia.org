/**
 * Whether POST /api/donations will take money, and the interlock behind it.
 *
 * This used to be a hardcoded `false`, because the only provider available
 * was a mock that fabricated a VA number no bank issued. That is no longer
 * true: SumopodProvider issues a QRIS link a real person can pay and
 * verifies the signed webhook that settles it.
 *
 * It is a switch rather than a constant now because development needs the
 * whole flow running against the Sumopod sandbox while production stays
 * shut. One constant cannot be both.
 */

import { paymentProviderProductionRefusal } from '@/lib/payments/production-readiness';

/**
 * The deliberate switch, off unless explicitly turned on.
 *
 * NEXT_PUBLIC_ because the donate page reads it too, to show the disabled
 * message before a donor fills in an amount rather than after they submit.
 * That also means it is inlined into the client bundle at build time: a
 * Docker deployment changes it by rebuilding, not by restarting.
 *
 * Only the exact string `true` counts. "1", "yes", "TRUE" and a trailing
 * space are all somebody almost turning it on, and guessing in the
 * permissive direction turns a typo into live money collection.
 */
export function donationsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DONATIONS_ENABLED === 'true';
}

/**
 * Why donations must not run in this environment despite the switch, or null
 * if they may.
 *
 * Server-side only: it reads variables that are not NEXT_PUBLIC_, so on the
 * client every check would see undefined. The donate page does not call it;
 * the API route does, and the API route is the authoritative gate.
 *
 * The case it exists for is not hypothetical. Sandbox credentials left in
 * production take real rupiah into an account that settles nowhere: the
 * donor pays, the webhook never comes, the ledger never moves, and the money
 * is simply gone as far as this platform can tell. There is no recovery
 * path, so it is refused here rather than remembered in a deploy checklist.
 *
 * WHICH PROVIDER, and whose knowledge that is. The per-provider rules live
 * beside the registry (@/lib/payments/production-readiness), not here: they used
 * to be two string literals compared in this file, a second list of the
 * providers that exist, and this guard runs before getPaymentProvider is ever
 * reached -- so a provider in the registry and not in those two was taking real
 * rupiah with nothing checking whether it was a sandbox. What is left here is
 * the environment half, which is this file's own business: the switch, and
 * whether this is production at all.
 */
export function sandboxInProductionReason(): string | null {
  if (process.env.NODE_ENV !== 'production') return null;

  return paymentProviderProductionRefusal(process.env.PAYMENT_PROVIDER ?? 'mock');
}

/**
 * Returned as the body of a 503 while donations are off. Plain Indonesian,
 * no apology, no promised date -- this is what a real donor sees on a live
 * donation site.
 */
export const DONATIONS_DISABLED_MESSAGE =
  'Donasi sedang tidak tersedia karena sistem pembayaran sedang disiapkan.';
