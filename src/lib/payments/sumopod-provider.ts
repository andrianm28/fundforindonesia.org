import { InvalidWebhookSignatureError } from './mock-provider';
import { verifySumopodSignature } from './sumopod-signature';
import type {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
  PaymentStatusResult,
  PayoutInput,
  PayoutResult,
  WebhookEvent,
} from './types';

/**
 * Raised for the parts of PaymentProvider that Sumopod does not have.
 *
 * Distinct from a generic Error so callers can tell "this provider cannot do
 * that" from "that failed". Sumopod offers QRIS collection and nothing else:
 * no disbursement API, no payment status API, no balance API. Answering those
 * calls with a plausible-looking stub would be worse than refusing, because a
 * stubbed payout reads as a payout that happened.
 */
export class SumopodNotSupportedError extends Error {
  constructor(capability: string, subject: string) {
    super(
      `Sumopod does not provide ${capability}, so ${subject} cannot be handled here. ` +
        'Activate a provider that does, or do it by hand in the Sumopod dashboard.',
    );
    this.name = 'SumopodNotSupportedError';
  }
}

export interface SumopodConfig {
  apiKey: string;
  webhookSecret: string;
  baseUrl: string;
  /** Injected in tests. Production passes nothing and gets global fetch. */
  fetchImpl?: typeof fetch;
}

/** Sumopod's two QRIS products. `QRIS` settles T+2, `QRIS_INSTANT` T+0. */
export type SumopodMethodCode = 'QRIS' | 'QRIS_INSTANT';

interface SumopodChargeResponse {
  payment_id?: string;
  payment_link_url?: string;
  expires_at?: string;
  fee?: number;
  net_amount?: number;
}

/**
 * Sumopod reports whole rupiah as a JSON number, unlike Midtrans's decimal
 * string. Anything that is not a finite number becomes NaN on purpose: the
 * webhook route compares the gross against Payment.amount and refuses to
 * settle on mismatch, and NaN is unequal to every real amount, so a missing
 * or malformed figure fails closed instead of quietly becoming zero.
 */
function toRupiah(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : NaN;
}

/**
 * Parses one of the payload's own timestamp fields (`paid_at`, `settled_at`),
 * or undefined if the field is missing or not a valid date -- never NaN or a
 * guessed value, so the caller decides its own fallback explicitly rather
 * than silently getting `Invalid Date`.
 */
function parseProviderTimestamp(raw: unknown): Date | undefined {
  if (typeof raw !== 'string') return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The Sumopod adapter: QRIS collection through a hosted payment page, with
 * svix-signed webhooks.
 *
 * Worth noting against the warning on PaymentProvider.parseWebhook: the
 * Midtrans gap does not apply here. Midtrans signs only
 * `order_id + status_code + gross_amount`, leaving `transaction_status`
 * outside the signed message, so a captured payload can be replayed with the
 * status flipped. The svix scheme signs the entire raw body, so the event
 * type, the amount and the fee are all covered. That is why this adapter can
 * return `paid` on the notification alone, and why it does not need the
 * status API it does not have.
 */
export class SumopodProvider implements PaymentProvider {
  readonly name = 'sumopod';
  readonly method = 'qris_redirect' as const;

  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly methodCode: SumopodMethodCode;

  constructor(config: SumopodConfig & { methodCode?: SumopodMethodCode }) {
    if (!config.apiKey) {
      throw new Error('SumopodProvider requires a non-empty apiKey');
    }
    if (!config.webhookSecret) {
      // Fail at construction, loudly. An empty secret verifies every
      // signature against nothing, which does not look broken -- it looks
      // like a working webhook that accepts forged settlements.
      throw new Error('SumopodProvider requires a non-empty webhookSecret');
    }
    if (!config.baseUrl) {
      throw new Error('SumopodProvider requires a non-empty baseUrl');
    }
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.methodCode = config.methodCode ?? 'QRIS';
  }

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
      },
      body: JSON.stringify({
        order_id: input.orderId,
        amount: input.grossAmount,
        currency: input.currency,
        payment_method_type_code: this.methodCode,
        ...(input.successReturnUrl ? { success_return_url: input.successReturnUrl } : {}),
        ...(input.cancelReturnUrl ? { cancel_return_url: input.cancelReturnUrl } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Sumopod refused the charge for ${input.orderId}: HTTP ${response.status} ${await response.text()}`,
      );
    }

    const body = (await response.json()) as SumopodChargeResponse;

    // A 200 with no link is a charge the donor can never pay. Recording it as
    // if it were fine leaves a PENDING Payment nobody can settle, so this
    // refuses rather than returning a half-built charge.
    if (!body.payment_link_url) {
      throw new Error(
        `Sumopod returned no payment_link_url for ${input.orderId}; refusing to record an unpayable charge`,
      );
    }
    return {
      // Our own order id, echoed, exactly as MockPaymentProvider does -- not
      // Sumopod's payment_id. This value becomes Payment.providerRef, and the
      // webhook route finds a Payment by matching it against what
      // parseWebhook reports, which is `data.order_id`. Returning Sumopod's
      // id here instead would make the two disagree, and every settlement
      // would log "unknown providerRef", answer 200, and leave a paid
      // donation PENDING forever.
      providerOrderId: input.orderId,
      method: 'qris_redirect',
      redirectUrl: body.payment_link_url,
      // Sumopod caps the window at 24 hours and always answers with the
      // concrete expiry, so this is read rather than recomputed.
      expiresAt: new Date(body.expires_at ?? Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const id = req.headers.get('svix-id');
    const timestamp = req.headers.get('svix-timestamp');
    const signature = req.headers.get('svix-signature');

    // Read the body as text and verify before parsing. The signature covers
    // the bytes; JSON.parse followed by JSON.stringify would reorder keys and
    // drop whitespace, and the re-serialised body would never verify.
    const body = await req.text();

    if (!id || !timestamp || !signature) {
      throw new InvalidWebhookSignatureError();
    }

    const valid = await verifySumopodSignature({ id, timestamp, body, header: signature }, this.webhookSecret);
    if (!valid) {
      throw new InvalidWebhookSignatureError();
    }

    const payload = JSON.parse(body) as { event_type?: string; data?: Record<string, unknown> };
    const data = payload.data ?? {};

    const status: WebhookEvent['status'] =
      payload.event_type === 'payment.completed'
        ? 'paid'
        : payload.event_type === 'payment.failed'
          ? 'failed'
          : payload.event_type === 'payment.expired'
            ? 'expired'
            : 'ignored';

    // Sumopod reports `paid_at` (when the donor actually paid) and
    // `settled_at` (its own T+2-for-QRIS estimate of when the money clears)
    // separately on every event (docs/integrasi-sumopod.md, "Waktu dan
    // Escrow"). A missing or malformed `paid_at` falls back to receipt time,
    // the same degrade-gracefully behaviour this route always had before
    // either field existed. A missing `settled_at` falls back to `paidAt`
    // itself (T+0) -- Sumopod always sends one for a real
    // `payment.completed`, so this only fires for a malformed payload or a
    // status this adapter does not otherwise act on (`ignored`/`failed`/
    // `expired`).
    const paidAt = parseProviderTimestamp(data.paid_at) ?? new Date();
    const settledAt = parseProviderTimestamp(data.settled_at) ?? paidAt;

    return {
      provider: 'sumopod',
      // The svix message id, not anything in the body: it is what the
      // signature covers and what the dashboard's resend button reuses, so it
      // is the only value that makes a replay look like a replay.
      providerEventId: id,
      providerOrderId: String(data.order_id ?? ''),
      status,
      grossAmount: toRupiah(data.amount),
      providerFee: typeof data.fee === 'number' && Number.isFinite(data.fee) ? data.fee : undefined,
      rawPayload: payload,
      paidAt,
      settledAt,
    };
  }

  async getStatus(orderId: string): Promise<PaymentStatusResult> {
    throw new SumopodNotSupportedError('a payment status API', `a status lookup for ${orderId}`);
  }

  async createPayout(input: PayoutInput): Promise<PayoutResult> {
    throw new SumopodNotSupportedError('a disbursement API', `payout ${input.referenceId}`);
  }
}
