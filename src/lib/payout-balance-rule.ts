/**
 * The one rule for how much of a balance a single Payout may ask for:
 * anything above it is refused. CONTEXT.md, Payout -- a Fundraiser asks to
 * send "sebagian Campaign Balance" to a verified Bank Account.
 *
 * THE MONEY LAYER OWNS THE DECISION, and this is where it says so. It lives
 * here, free of Prisma values, so every caller can ask the same question
 * instead of writing its own `>`. That is requestPayout and approvePayout --
 * the two places in ./money/payouts.ts that judge an amount against a balance,
 * the second of them under the subject's row lock and at the moment the
 * balance stops being withdrawable -- and the screen
 * (./components/campaign/CampaignPayoutPanel.tsx), which warns a Fundraiser
 * before they submit. Two copies of a comparison in money code is how the
 * screen starts offering an amount the server refuses, or -- worse -- stops
 * refusing one the screen has quietly stopped warning about, with nothing to
 * make the disagreement visible. Same arrangement as
 * ./payout-requestable-statuses.ts, for the same reason: the list a screen
 * offers and the one the money layer accepts are one list.
 *
 * The three callers are pinned against this module -- forced to answer
 * something this comparison never would, and compared to it boundary rupiah
 * by boundary rupiah -- by src/__tests__/payout-balance-rule-callers.test.tsx,
 * so a fourth caller, or a second copy, is a failing test rather than a
 * disagreement nobody sees.
 *
 * This asks ONE question and answers it. It does not decide that an amount is
 * a valid request, only that it is more than the balance; a caller wanting the
 * whole verdict has to ask for the rest of it.
 */
export function exceedsPayoutBalance(amount: number, balance: number): boolean {
  return amount > balance;
}
