import { computeMidtransSignature, verifyMidtransSignature } from './signature';
import type {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
  PaymentStatusResult,
  PayoutInput,
  PayoutResult,
  WebhookEvent,
} from './types';

const VA_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Midtrans sends gross_amount as a decimal string ("100000.00") even for
 * IDR, which has no subunit. Splitting on "." and parsing the integer part
 * keeps this off of parseFloat -- rupiah are Int, never float, all the way
 * through this boundary, not just once it reaches a Prisma column. A
 * malformed string parses to NaN, which compares unequal to every real
 * Payment.amount, so a corrupt amount fails closed as a mismatch rather than
 * silently becoming 0.
 */
function parseGrossAmount(raw: string): number {
  return parseInt(raw.split('.')[0] ?? '', 10);
}

/**
 * Behaves like a real bank-transfer-VA provider -- issues a VA number, and
 * accepts webhook payloads shaped and signed exactly like Midtrans's real ones
 * -- with no network call and no merchant account.
 *
 * The signature check is not simulated. It runs the documented Midtrans
 * algorithm against a real secret, so the webhook route's rejection path is
 * exercised for real rather than stubbed, and swapping in a genuine Midtrans
 * adapter changes the provider class and nothing else.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly method = 'bank_transfer_va' as const;

  private readonly serverKey: string;

  /**
   * In-memory charge registry. The database holds the authoritative Payment
   * row; this exists only so getStatus has something to answer from. It does
   * not survive a restart, which is fine because nothing depends on it.
   */
  private readonly charges = new Map<string, ChargeResult>();

  constructor(config: { serverKey: string }) {
    if (!config.serverKey) {
      // Fail loudly at construction. An empty server key means every
      // signature verifies against a secret anyone can guess, which is worse
      // than having no webhook at all -- it looks like it is working.
      throw new Error('MockPaymentProvider requires a non-empty serverKey');
    }
    this.serverKey = config.serverKey;
  }

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    // A VA number derived from the order id: stable per order and shaped like
    // a real one (banks issue 10-16 digits). Not cryptographically meaningful
    // and not meant to be -- this is the one part that is genuinely a mock.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(input.orderId),
    );
    const vaNumber = Array.from(new Uint8Array(digest).slice(0, 7))
      .map((b) => b.toString().padStart(3, '0'))
      .join('')
      .slice(0, 14);

    const result: ChargeResult = {
      providerOrderId: input.orderId,
      method: 'bank_transfer_va',
      vaNumber,
      expiresAt: new Date(Date.now() + VA_EXPIRY_MS),
    };
    this.charges.set(input.orderId, result);
    return result;
  }

  /**
   * Test and development helper, deliberately not on the PaymentProvider
   * interface. Produces a payload shaped and signed exactly like a real
   * Midtrans notification, so the webhook can be exercised end to end.
   */
  async simulateWebhookPayload(
    orderId: string,
    grossAmount: number,
    transactionStatus = 'settlement',
    eventId?: string,
  ): Promise<Record<string, unknown>> {
    const statusCode = '200';
    // Midtrans sends gross_amount with two decimal places even for IDR, and
    // signs that exact string. Reproducing the formatting is part of
    // reproducing the scheme.
    const grossAmountStr = `${grossAmount}.00`;
    const signature = await computeMidtransSignature(
      { orderId, statusCode, grossAmount: grossAmountStr },
      this.serverKey,
    );
    return {
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmountStr,
      transaction_status: transactionStatus,
      transaction_id: eventId ?? `evt-${orderId}-${transactionStatus}`,
      signature_key: signature,
    };
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const body = (await req.json()) as Record<string, unknown>;
    const orderId = String(body.order_id ?? '');
    const statusCode = String(body.status_code ?? '');
    const grossAmount = String(body.gross_amount ?? '');
    const providedSignature = String(body.signature_key ?? '');

    const valid = await verifyMidtransSignature(
      { orderId, statusCode, grossAmount },
      providedSignature,
      this.serverKey,
    );
    if (!valid) {
      // Throws rather than returning an event with a validity flag. A caller
      // that forgets to check a flag accepts forged money; a caller that
      // forgets to catch gets a 500 and accepts nothing.
      throw new InvalidWebhookSignatureError();
    }

    const transactionStatus = String(body.transaction_status ?? '');
    const status: WebhookEvent['status'] =
      transactionStatus === 'settlement' || transactionStatus === 'capture'
        ? 'paid'
        : transactionStatus === 'expire'
          ? 'expired'
          : 'failed';

    return {
      provider: 'mock',
      providerEventId: String(body.transaction_id ?? ''),
      providerOrderId: orderId,
      status,
      grossAmount: parseGrossAmount(grossAmount),
      rawPayload: body,
    };
  }

  async getStatus(orderId: string): Promise<PaymentStatusResult> {
    const charge = this.charges.get(orderId);
    return { providerOrderId: orderId, status: charge ? 'pending' : 'failed' };
  }

  async createPayout(input: PayoutInput): Promise<PayoutResult> {
    // Mirrors Xendit's Payouts API v2 response shape so a real adapter reuses
    // this interface unchanged. This mock completes synchronously; a real one
    // would return "pending" and finish later via its own callback.
    return {
      payoutId: `payout-${input.referenceId}`,
      status: 'completed',
    };
  }
}

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super('invalid webhook signature');
    this.name = 'InvalidWebhookSignatureError';
  }
}
