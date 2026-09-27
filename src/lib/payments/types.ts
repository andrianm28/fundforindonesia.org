/**
 * The seam between this platform and whoever actually moves the money.
 *
 * Ported from the FFI repo's `packages/payments`, with one deliberate change:
 * amounts are `number`, not `bigint`. FFI used bigint because its Drizzle
 * schema did; this repo stores rupiah as Prisma `Int`, and mixing the two
 * numeric types across the boundary is how a conversion gets forgotten.
 *
 * Every method here is something a real provider does. Nothing in the app
 * depends on a concrete provider -- swapping Midtrans for Xendit should be a
 * new class implementing this interface, not a change to the webhook route.
 */

export type PaymentMethod = 'bank_transfer_va' | 'qris_redirect';

export interface ChargeInput {
  /** Our reference, which the provider echoes back on every webhook. */
  orderId: string;
  grossAmount: number;
  currency: 'IDR';
  /** Only meaningful for redirect-based methods; ignored by VA flows. */
  successReturnUrl?: string;
  cancelReturnUrl?: string;
}

export type ChargeResult =
  | {
      providerOrderId: string;
      method: 'bank_transfer_va';
      vaNumber: string;
      expiresAt: Date;
    }
  | {
      providerOrderId: string;
      method: 'qris_redirect';
      redirectUrl: string;
      expiresAt: Date;
    };

export interface WebhookEvent {
  /** Which provider delivered this. Half of the idempotency key. */
  provider: string;
  /**
   * The provider's own id for this event. The other half of the idempotency
   * key, and the reason a retried delivery is a no-op rather than a second
   * credit.
   */
  providerEventId: string;
  providerOrderId: string;
  /**
   * `ignored` is not an outcome for a payment -- it is this adapter saying
   * "authentic, but about nothing this platform tracks": a dashboard test
   * ping, or an event type added by the provider after this code shipped.
   * The route answers 200 and writes nothing. It exists because the
   * alternative, folding an unknown event into `failed`, would mark a live
   * donation failed on the strength of a word this code does not recognise.
   */
  status: 'paid' | 'failed' | 'expired' | 'ignored';
  /**
   * The settled amount the provider is vouching for, in whole rupiah, read
   * from the same signed fields the signature covers. Not what the webhook
   * route credits -- Payment.amount (this platform's own record of what was
   * charged) stays the credited figure -- but what it cross-checks against
   * before crediting anything. A provider that settles a different amount
   * than it was charged (a partial capture, an underpaid VA) must not be
   * credited as if the full charge arrived.
   */
  grossAmount: number;
  /**
   * What the provider kept, in whole rupiah, when its payload says so.
   * Left undefined by providers that do not report a fee; the route treats
   * that as zero. Getting this wrong is not cosmetic: paymentSettledLegs
   * credits the campaign the NET, so a fee silently read as zero credits the
   * campaign money the provider actually kept, and the gap only surfaces when
   * the reconciliation report disagrees with the bank.
   */
  providerFee?: number;
  rawPayload: unknown;
  /**
   * When the provider says the donor actually paid, read from its signed
   * payload. This becomes Payment.paidAt -- server receipt time is never
   * used for it, so a delayed delivery cannot make a donation look like it
   * arrived later than it did. A provider whose payload carries no such
   * timestamp reports server receipt time here itself (prd-compliance 19):
   * a display-only figure degrading gracefully, not a security-critical one
   * worth failing the whole notification over.
   */
  paidAt: Date;
  /**
   * When the provider expects this payment's money to become a withdrawable
   * balance -- an ESTIMATE, not proof of settlement (docs/integrasi-sumopod.md,
   * "Waktu dan Escrow"): none of the providers this repo speaks to expose a
   * balance API to confirm money has actually landed. Escrow release is
   * computed from this, never from paidAt or server receipt time
   * (prd-compliance 19) -- anchoring to receipt time would let a
   * slow-settling provider's Escrow Hold lapse before the money has actually
   * cleared. A provider whose payload carries no settlement estimate at all
   * must set this equal to paidAt (T+0) itself -- decided here, in the
   * adapter that knows it has no better number, never guessed downstream in
   * the escrow layer.
   */
  settledAt: Date;
}

export interface PaymentStatusResult {
  providerOrderId: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
}

/**
 * Field names mirror Xendit's Payouts API v2 (reference_id + channel_code +
 * channel_properties) rather than the older Disbursement API's
 * external_id/bank_code, so a real adapter reuses this shape unchanged.
 * channelCode is e.g. "ID_BCA".
 */
export interface PayoutInput {
  referenceId: string;
  amount: number;
  channelCode: string;
  accountNumber: string;
  accountHolderName: string;
  description: string;
}

export interface PayoutResult {
  payoutId: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface PaymentProvider {
  /**
   * How this provider is named in its webhook path, on every Payment row it
   * creates, and on every WebhookEvent recorded for it. One string, used
   * everywhere, so per-provider reconciliation cannot quietly compare rows
   * labelled two different ways.
   */
  readonly name: string;
  /**
   * The one method this provider charges through. Declared rather than
   * discovered, so the donation route can tell a donor their chosen method
   * is unavailable *before* a charge exists at the provider, instead of
   * creating one and abandoning it.
   */
  readonly method: PaymentMethod;
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  /**
   * Verifies the signature and returns the event, or throws. It must never
   * return an unverified event: the caller has no other way to tell a genuine
   * notification from a forged one.
   *
   * The returned `status` is only as trustworthy as whatever the signature
   * actually covers. Midtrans's documented scheme -- the one signature.ts
   * implements -- signs `order_id + status_code + gross_amount + server_key`
   * and nothing else; `transaction_status` and `transaction_id` sit outside
   * the signed message. That means a single observed, correctly signed
   * payload for an order can be replayed with `transaction_status` changed
   * from e.g. `expire` to `settlement` and a fresh `transaction_id` --
   * defeating both the WebhookEvent dedupe and the paid/failed distinction --
   * without failing signature verification, because the signature never
   * covered either field. A real adapter for a provider with this same gap
   * MUST NOT treat `status` as settled on the notification's say-so alone; it
   * must confirm settlement through the provider's own status API
   * (`getStatus` here) before returning `status: 'paid'`. This mock does not
   * do that -- MockPaymentProvider.getStatus always reports 'pending' for
   * every known charge, since it has no real settlement to observe, so
   * calling it here would break settlement rather than harden it.
   */
  parseWebhook(req: Request): Promise<WebhookEvent>;
  getStatus(orderId: string): Promise<PaymentStatusResult>;
  createPayout(input: PayoutInput): Promise<PayoutResult>;
}
