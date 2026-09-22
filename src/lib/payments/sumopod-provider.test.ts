import { describe, it, expect } from 'vitest';
import { SumopodProvider, SumopodNotSupportedError } from './sumopod-provider';
import { InvalidWebhookSignatureError } from './mock-provider';
import { computeSumopodSignature } from './sumopod-signature';

const API_KEY = 'test-api-key';
const WEBHOOK_SECRET = 'whsec_OkjY4nDqKbBxbBRPcHjT5ZvpXeWTm6J2';
const BASE_URL = 'https://api-pay-sandbox.sumopod.com/api/v1';

function provider(fetchImpl?: typeof fetch) {
  return new SumopodProvider({
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
    baseUrl: BASE_URL,
    fetchImpl,
  });
}

/** A fetch that records its call and answers with the given JSON. */
function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const CHARGE_RESPONSE = {
  payment_id: '6f1c2f7e-0000-4000-8000-000000000001',
  order_id: 'donation-1',
  amount: 50000,
  fee: 650,
  net_amount: 49350,
  payment_link_url: 'https://pay.sumopod.com/pay/6f1c2f7e',
  payment_code: '1308300301295957',
  payment_code_type: 'ACCOUNT_NUMBER',
  payment_channel_used: 'QRIS',
  status: 'pending',
  expires_at: '2026-09-20T12:00:00Z',
};

/** Builds a genuinely signed webhook request, the way Sumopod sends one. */
async function signedRequest(payload: unknown, overrides: Partial<{ id: string; secret: string }> = {}) {
  const body = JSON.stringify(payload);
  const id = overrides.id ?? 'msg_2abcDEF1234567890';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await computeSumopodSignature(
    { id, timestamp, body },
    overrides.secret ?? WEBHOOK_SECRET,
  );
  return new Request('https://fundforindonesia.org/api/webhooks/sumopod', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    body,
  });
}

const COMPLETED_PAYLOAD = {
  event_type: 'payment.completed',
  data: {
    payment_id: '6f1c2f7e-0000-4000-8000-000000000001',
    order_id: 'donation-1',
    amount: 50000,
    fee: 650,
    net_amount: 49350,
    status: 'completed',
    payment_method: 'qris',
    paid_at: '2026-09-19T12:00:00Z',
    settled_at: '2026-09-21T12:00:00Z',
    completed_at: '2026-09-21T12:00:00Z',
  },
};

describe('SumopodProvider.createCharge', () => {
  it('posts the documented body to the payments endpoint with the api key', async () => {
    const { impl, calls } = stubFetch(200, CHARGE_RESPONSE);

    await provider(impl).createCharge({
      orderId: 'donation-1',
      grossAmount: 50000,
      currency: 'IDR',
      successReturnUrl: 'https://fundforindonesia.org/ok',
      cancelReturnUrl: 'https://fundforindonesia.org/cancel',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/payments`);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['X-Api-Key']).toBe(API_KEY);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      order_id: 'donation-1',
      amount: 50000,
      currency: 'IDR',
      payment_method_type_code: 'QRIS',
      success_return_url: 'https://fundforindonesia.org/ok',
      cancel_return_url: 'https://fundforindonesia.org/cancel',
    });
  });

  it('returns a qris_redirect charge carrying the hosted payment link', async () => {
    const { impl } = stubFetch(200, CHARGE_RESPONSE);

    const charge = await provider(impl).createCharge({
      orderId: 'donation-1',
      grossAmount: 50000,
      currency: 'IDR',
    });

    expect(charge).toEqual({
      providerOrderId: 'donation-1',
      method: 'qris_redirect',
      redirectUrl: 'https://pay.sumopod.com/pay/6f1c2f7e',
      expiresAt: new Date('2026-09-20T12:00:00Z'),
    });
  });

  it('throws when the provider answers a non-2xx status', async () => {
    const { impl } = stubFetch(422, { error: 'amount too small' });

    await expect(
      provider(impl).createCharge({ orderId: 'd', grossAmount: 1, currency: 'IDR' }),
    ).rejects.toThrow(/422/);
  });

  it('throws when the response carries no payment link', async () => {
    // A 200 with a missing link would otherwise become a charge the donor
    // can never pay, recorded as if it were fine.
    const { impl } = stubFetch(200, { ...CHARGE_RESPONSE, payment_link_url: undefined });

    await expect(
      provider(impl).createCharge({ orderId: 'd', grossAmount: 50000, currency: 'IDR' }),
    ).rejects.toThrow(/payment_link_url/);
  });
});

describe('SumopodProvider identity', () => {
  it('names itself sumopod, matching its webhook path and its Payment rows', async () => {
    // The route records this on every Payment, and the webhook route records
    // the same string on every WebhookEvent. A Payment labelled with the
    // wrong provider makes per-provider reconciliation lie.
    expect(provider().name).toBe('sumopod');
  });

  it('declares qris_redirect as the only method it can charge', () => {
    // Sumopod has no virtual account, no e-wallet and no card. The donation
    // route asks before charging, so a donor who picked bank transfer is
    // told up front instead of being sent to a QRIS page they did not ask
    // for.
    expect(provider().method).toBe('qris_redirect');
  });
});

describe('SumopodProvider order id round trip', () => {
  it('reports the same providerOrderId from createCharge as from the webhook for that order', async () => {
    // This is the invariant the webhook route depends on: it finds a Payment
    // by `providerRef`, which is whatever createCharge called the order, and
    // matches it against whatever parseWebhook calls the order. If the two
    // disagree the webhook silently finds nothing, logs "unknown providerRef"
    // and answers 200, and the donation sits PENDING forever while the donor
    // has paid. MockPaymentProvider echoes input.orderId for exactly this
    // reason.
    const { impl } = stubFetch(200, CHARGE_RESPONSE);

    const charge = await provider(impl).createCharge({
      orderId: 'donation-1',
      grossAmount: 50000,
      currency: 'IDR',
    });
    const event = await provider().parseWebhook(await signedRequest(COMPLETED_PAYLOAD));

    expect(charge.providerOrderId).toBe(event.providerOrderId);
  });
});

describe('SumopodProvider.parseWebhook', () => {
  it('returns a paid event for a correctly signed payment.completed', async () => {
    const event = await provider().parseWebhook(await signedRequest(COMPLETED_PAYLOAD));

    expect(event).toMatchObject({
      provider: 'sumopod',
      providerEventId: 'msg_2abcDEF1234567890',
      providerOrderId: 'donation-1',
      status: 'paid',
      grossAmount: 50000,
      providerFee: 650,
    });
  });

  it('takes the event id from svix-id, not from the body', async () => {
    // svix-id is what the signature covers and what the dashboard's resend
    // reuses, so it is the only safe idempotency key.
    const req = await signedRequest(COMPLETED_PAYLOAD, { id: 'msg_unique_delivery' });

    const event = await provider().parseWebhook(req);

    expect(event.providerEventId).toBe('msg_unique_delivery');
  });

  it('maps payment.failed to failed', async () => {
    const req = await signedRequest({ ...COMPLETED_PAYLOAD, event_type: 'payment.failed' });

    await expect(provider().parseWebhook(req)).resolves.toMatchObject({ status: 'failed' });
  });

  it('maps payment.expired to expired', async () => {
    const req = await signedRequest({ ...COMPLETED_PAYLOAD, event_type: 'payment.expired' });

    await expect(provider().parseWebhook(req)).resolves.toMatchObject({ status: 'expired' });
  });

  it('maps payment.test to ignored so the dashboard ping touches nothing', async () => {
    const req = await signedRequest({ event_type: 'payment.test', data: {} });

    await expect(provider().parseWebhook(req)).resolves.toMatchObject({ status: 'ignored' });
  });

  it('maps an unrecognised event type to ignored rather than guessing', async () => {
    const req = await signedRequest({ ...COMPLETED_PAYLOAD, event_type: 'payment.somethingNew' });

    await expect(provider().parseWebhook(req)).resolves.toMatchObject({ status: 'ignored' });
  });

  it('throws when the signature does not match', async () => {
    const req = await signedRequest(COMPLETED_PAYLOAD, { secret: 'whsec_AAAAAAAAAAAAAAAA' });

    await expect(provider().parseWebhook(req)).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('throws when the body was altered after signing', async () => {
    const good = await signedRequest(COMPLETED_PAYLOAD);
    const tampered = new Request(good.url, {
      method: 'POST',
      headers: good.headers,
      body: JSON.stringify({
        ...COMPLETED_PAYLOAD,
        data: { ...COMPLETED_PAYLOAD.data, amount: 5_000_000 },
      }),
    });

    await expect(provider().parseWebhook(tampered)).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });

  it('throws when the svix headers are missing entirely', async () => {
    const req = new Request('https://fundforindonesia.org/api/webhooks/sumopod', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(COMPLETED_PAYLOAD),
    });

    await expect(provider().parseWebhook(req)).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('verifies against the raw body, not a re-serialised one', async () => {
    // Sumopod's own warning: one reformatted whitespace character breaks the
    // match. Signing a body with spacing that JSON.stringify would not
    // reproduce proves the adapter never round-trips it.
    const body = '{\n  "event_type": "payment.completed",\n  "data": { "order_id": "donation-1", "amount": 50000, "fee": 650 }\n}';
    const id = 'msg_whitespace';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await computeSumopodSignature({ id, timestamp, body }, WEBHOOK_SECRET);
    const req = new Request('https://fundforindonesia.org/api/webhooks/sumopod', {
      method: 'POST',
      headers: {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      },
      body,
    });

    await expect(provider().parseWebhook(req)).resolves.toMatchObject({
      status: 'paid',
      grossAmount: 50000,
    });
  });

  it('reports a NaN gross amount when the payload omits it, so the route refuses to settle', async () => {
    // The webhook route compares grossAmount against Payment.amount and
    // refuses to settle on mismatch. NaN is unequal to every real amount, so
    // a missing amount fails closed instead of becoming 0.
    const req = await signedRequest({
      event_type: 'payment.completed',
      data: { order_id: 'donation-1', fee: 650 },
    });

    const event = await provider().parseWebhook(req);

    expect(Number.isNaN(event.grossAmount)).toBe(true);
  });
});

describe('SumopodProvider capabilities it does not have', () => {
  it('refuses createPayout, because Sumopod has no disbursement API', async () => {
    await expect(
      provider().createPayout({
        referenceId: 'payout-1',
        amount: 100000,
        channelCode: 'ID_BCA',
        accountNumber: '123',
        accountHolderName: 'A',
        description: 'd',
      }),
    ).rejects.toBeInstanceOf(SumopodNotSupportedError);
  });

  it('refuses getStatus, because Sumopod has no status API', async () => {
    await expect(provider().getStatus('donation-1')).rejects.toBeInstanceOf(
      SumopodNotSupportedError,
    );
  });
});

describe('SumopodProvider configuration', () => {
  it('refuses to construct without an api key', () => {
    expect(
      () => new SumopodProvider({ apiKey: '', webhookSecret: WEBHOOK_SECRET, baseUrl: BASE_URL }),
    ).toThrow(/apiKey/);
  });

  it('refuses to construct without a webhook secret', () => {
    // An empty secret makes every signature verify against nothing, which
    // looks like it is working and accepts forged settlements.
    expect(
      () => new SumopodProvider({ apiKey: API_KEY, webhookSecret: '', baseUrl: BASE_URL }),
    ).toThrow(/webhookSecret/);
  });
});

describe('SumopodProvider does not reach the network when parsing', () => {
  it('parses a webhook with no fetch available at all', async () => {
    const exploding = (() => {
      throw new Error('network call during webhook parsing');
    }) as unknown as typeof fetch;

    await expect(
      provider(exploding).parseWebhook(await signedRequest(COMPLETED_PAYLOAD)),
    ).resolves.toMatchObject({ status: 'paid' });
  });
});
