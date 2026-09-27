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
 * by boundary rupiah -- by src/__tests__/payout-balance-rule-callers.test.tsx.
 *
 * What that file holds is those three, by name, and NOT "there is no fourth".
 * An earlier version of this comment claimed a fourth caller was a failing
 * test. It is not: the test exercises the three it names, and a `previewPayout`
 * written beside them with a comparison of its own left the whole suite green.
 * A scan was written to close that and thrown away rather than claimed, for
 * the reason the ticket records: scanning for references to this function
 * cannot see a caller that re-decides the cap and never names it -- the only
 * kind worth catching -- and scanning for the COMPARISON would match one
 * spelling of `>` and no other, which is the green-for-the-wrong-reason
 * docs/agents/verification.md is about. The honest scope: these three cannot
 * drift from this module; a fourth place is caught by the test for that place,
 * when somebody writes one.
 *
 * This asks ONE question and answers it. It does not decide that an amount is
 * a valid request, only that it is more than the balance; a caller wanting the
 * whole verdict has to ask for the rest of it.
 */
export function exceedsPayoutBalance(amount: number, balance: number): boolean {
  return amount > balance;
}
