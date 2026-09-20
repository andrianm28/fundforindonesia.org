/**
 * The "Kantong Donasi" wallet has been removed.
 *
 * Both of its endpoints are gone: `POST /api/user/topup`, which credited
 * `User.donationBalance` with no payment behind it, and
 * `POST /api/balance/donate`, which spent that balance by writing
 * `Campaign.collectedAmount` directly with no Payment and no ledger entry.
 * The guard test at
 * `src/__tests__/properties/collected-amount-single-writer.test.ts` keeps
 * them gone.
 *
 * What survives is `User.donationBalance` and the read-only
 * `GET /api/balance`, because five users hold balances totalling
 * Rp 1.371.884. That money is owed to them. It cannot be refunded through
 * the system yet -- refunds do not exist -- so the balance stays visible and
 * unspendable until it is settled, which is tracked separately from this
 * work.
 *
 * This message is what the account page shows those users so they understand
 * the balance is temporarily unspendable rather than gone.
 */
export const WALLET_DISABLED_MESSAGE =
  "Fitur Kantong Donasi sedang tidak tersedia. Anda tetap bisa berdonasi langsung ke campaign pilihan Anda.";
