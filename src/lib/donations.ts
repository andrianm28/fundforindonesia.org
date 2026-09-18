/**
 * POST /api/donations is gated shut.
 *
 * getPaymentProvider() (src/lib/payments/index.ts) resolves to
 * MockPaymentProvider today, and MockPaymentProvider fabricates a 14-digit
 * "VA number" derived from a SHA-256 hash of the donation id. No bank issued
 * it, nobody can pay it, and no webhook will ever arrive to settle it -- the
 * donation sits PENDING forever while the donor believes they have real
 * payment instructions. Inventing payment instructions for a method nobody
 * can pay through is exactly the habit this money layer exists to end (see
 * the paymentMethod check in src/app/api/donations/route.ts); a mock
 * provider standing in for a real one is that same habit wearing a
 * different hat.
 *
 * The only thing stopping this in production today is that every existing
 * campaign is flagged isDemo and refuses donations outright. isDemo
 * defaults to false, so the first campaign a real campaigner publishes
 * opens this path. This constant is what actually closes it.
 *
 * Do not flip this to true until getPaymentProvider() returns an adapter --
 * the Sumopod QRIS integration -- that issues payment instructions a real
 * person can actually pay, and that delivers a signed webhook back to
 * POST /api/webhooks/[provider] so a payment can actually settle. Until
 * then, this is the only thing standing between a live donate button and a
 * donor paying into a void.
 */
export const DONATIONS_ENABLED = false;

/**
 * Returned as the body of a 503 while DONATIONS_ENABLED is false. Plain
 * Indonesian, no apology, no promised date -- this is what a real donor
 * sees on a live donation site.
 */
export const DONATIONS_DISABLED_MESSAGE =
  'Donasi sedang tidak tersedia karena sistem pembayaran sedang disiapkan.';
