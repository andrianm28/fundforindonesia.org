import { isBetaSandbox } from '@/lib/deploy-environment';

/**
 * The mode of a movement of money (ticket rilis-1-benda/94): sandbox (the
 * public beta's test money, never counted as real) or real.
 *
 * Two names, and the difference between them is the whole design:
 *
 *  - `sandboxModeOf(row)` is the mode of a row that already exists. A ledger
 *    posting, a Refund, a UsageReport takes the mode of the row it is about (a
 *    Payment, a Refund, a Payout), never of the environment at the moment it
 *    happens. A Payout approved or a Refund paid after go-live against a beta
 *    Payment is still sandbox money, and the BETA_SANDBOX marker being gone
 *    changes nothing about that.
 *  - `currentSandboxStamp()` is the mode of a row being CREATED with no source
 *    row to inherit from: a Payout request, or a Manual Contribution approval.
 *    Only the marker in force at that moment can say, so it is the one place
 *    the marker is read for a ledger stamp (a Payment's own stamp is
 *    `currentPaymentSandboxStamp`, ./counted-payment.ts, the same rule).
 */
export function sandboxModeOf(row: { sandbox: boolean }): boolean {
  return row.sandbox;
}

export function currentSandboxStamp(): boolean {
  return isBetaSandbox();
}
