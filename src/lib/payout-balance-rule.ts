/**
 * The one rule for how much of a balance a single Payout may ask for:
 * anything above it is refused. CONTEXT.md, Payout -- a Fundraiser asks to
 * send "sebagian Campaign Balance" to a verified Bank Account.
 *
 * THE MONEY LAYER OWNS THE DECISION, and this is where it says so. It lives
 * here, free of Prisma values, so the browser can ask the same question
 * requestPayout asks (./money/payouts.ts) instead of writing its own `>`.
 * Two copies of a comparison in money code is how the screen starts offering
 * an amount the server refuses, or -- worse -- stops refusing one the screen
 * has quietly stopped warning about, with nothing to make the disagreement
 * visible. Same arrangement as ./payout-requestable-statuses.ts, for the same
 * reason: the list a screen offers and the one the money layer accepts are one
 * list.
 *
 * This asks ONE question and answers it. It does not decide that an amount is
 * a valid request, only that it is more than the balance; a caller wanting the
 * whole verdict has to ask for the rest of it.
 */
export function exceedsPayoutBalance(amount: number, balance: number): boolean {
  return amount > balance;
}
