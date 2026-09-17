/**
 * The "Kantong Donasi" wallet is disabled.
 *
 * `POST /api/user/topup` used to create a `TopUp` row and credit
 * `User.donationBalance` with no payment behind it whatsoever — any
 * authenticated user could mint balance and spend it via
 * `POST /api/balance/donate`, which writes straight to
 * `Campaign.collectedAmount`. That made the wallet a second, uncontrolled
 * writer of a field the settled-payment webhook is supposed to own alone
 * (see `src/app/api/webhooks/[provider]/route.ts`).
 *
 * Do not flip this back to `true` until a top-up itself requires a settled
 * `Payment` (see `src/lib/payments/`). Re-enabling the wallet before that
 * restores the second writer, and the headline collected-amount will drift
 * silently from the ledger, which is the one thing that must never happen.
 *
 * `User.donationBalance` and the `TopUp` model are left in place on
 * purpose: existing balances are a liability to honour later, not rows to
 * drop.
 */
export const WALLET_ENABLED = false;

/**
 * Standard response body for a wallet endpoint while WALLET_ENABLED is
 * false. Donating directly to a campaign still works — this only closes
 * the balance top-up/spend path.
 */
export const WALLET_DISABLED_MESSAGE =
  "Fitur Kantong Donasi sedang tidak tersedia. Anda tetap bisa berdonasi langsung ke campaign pilihan Anda.";
