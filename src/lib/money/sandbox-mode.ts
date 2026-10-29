import { isBetaSandbox } from '@/lib/deploy-environment';
import { SandboxRowInLiveModeError } from './errors';

/**
 * The mode of a movement of money (ticket rilis-1-benda/94): sandbox (the
 * public beta's test money, never counted as real) or real.
 *
 * Two names, and the difference between them is the whole design:
 *
 *  - `sandboxModeOf(row)` is the mode of a row that already exists. A ledger
 *    posting, a Refund, a UsageReport takes the mode of the row it is about (a
 *    Payment, a Refund, a Payout), never of the environment at the moment it
 *    happens. A Payout or Refund stamped sandbox stays sandbox money, and the
 *    BETA_SANDBOX marker being gone changes nothing about that -- which is why
 *    approving or completing one after go-live is refused outright
 *    (`requireNotSandboxInLiveMode`, below) rather than allowed to move real
 *    money against a test balance.
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

/**
 * Refuses to move a sandbox row (a Payout or Refund stamped with the beta's
 * test money) once the BETA_SANDBOX marker is gone (PAY-01). The row keeps its
 * own stamp for the ledger (`sandboxModeOf`), but approving or completing it in
 * live mode would send real provider money against a test balance, and the
 * Admin's typed provider balance cannot tell the difference. Rejecting it
 * (`rejectPayout`, `rejectRefund`) stays open: that is how a leftover is closed.
 */
export function requireNotSandboxInLiveMode(row: { sandbox: boolean }, what: 'Payout' | 'Refund'): void {
  if (sandboxModeOf(row) && !isBetaSandbox()) {
    throw new SandboxRowInLiveModeError(what);
  }
}
