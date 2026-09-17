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
  status: 'paid' | 'failed' | 'expired';
  rawPayload: unknown;
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
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  /**
   * Verifies the signature and returns the event, or throws. It must never
   * return an unverified event: the caller has no other way to tell a genuine
   * notification from a forged one.
   */
  parseWebhook(req: Request): Promise<WebhookEvent>;
  getStatus(orderId: string): Promise<PaymentStatusResult>;
  createPayout(input: PayoutInput): Promise<PayoutResult>;
}
