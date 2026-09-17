import { describe, it, expect } from 'vitest';
import { MockPaymentProvider, InvalidWebhookSignatureError } from './mock-provider';

const SERVER_KEY = 'SB-Mid-server-TESTKEY';

function provider() {
  return new MockPaymentProvider({ serverKey: SERVER_KEY });
}

function webhookRequest(payload: Record<string, unknown>): Request {
  return new Request('https://example.test/api/webhooks/mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('construction', () => {
  it('refuses an empty server key', () => {
    // An empty key verifies every signature against a secret anyone can
    // guess, and looks like it is working while doing it.
    expect(() => new MockPaymentProvider({ serverKey: '' })).toThrow(/non-empty serverKey/);
  });
});

describe('createCharge', () => {
  it('issues a VA number that looks like a bank VA number', async () => {
    const charge = await provider().createCharge({
      orderId: 'ORDER-1',
      grossAmount: 100_000,
      currency: 'IDR',
    });
    expect(charge.method).toBe('bank_transfer_va');
    if (charge.method !== 'bank_transfer_va') throw new Error('unreachable');
    expect(charge.vaNumber).toMatch(/^\d{10,16}$/);
    expect(charge.providerOrderId).toBe('ORDER-1');
  });

  it('is stable for the same order and different across orders', async () => {
    const p = provider();
    const a = await p.createCharge({ orderId: 'ORDER-1', grossAmount: 1, currency: 'IDR' });
    const b = await p.createCharge({ orderId: 'ORDER-1', grossAmount: 1, currency: 'IDR' });
    const c = await p.createCharge({ orderId: 'ORDER-2', grossAmount: 1, currency: 'IDR' });
    if (a.method !== 'bank_transfer_va' || b.method !== 'bank_transfer_va' || c.method !== 'bank_transfer_va')
      throw new Error('unreachable');
    // A donor who reloads the instructions page must see the same number.
    expect(a.vaNumber).toBe(b.vaNumber);
    expect(a.vaNumber).not.toBe(c.vaNumber);
  });

  it('sets an expiry in the future', async () => {
    const charge = await provider().createCharge({
      orderId: 'ORDER-3',
      grossAmount: 50_000,
      currency: 'IDR',
    });
    expect(charge.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('parseWebhook', () => {
  it('accepts a correctly signed settlement and reports it paid', async () => {
    const p = provider();
    const payload = await p.simulateWebhookPayload('ORDER-1', 100_000, 'settlement');
    const event = await p.parseWebhook(webhookRequest(payload));

    expect(event.status).toBe('paid');
    expect(event.provider).toBe('mock');
    expect(event.providerOrderId).toBe('ORDER-1');
    expect(event.providerEventId).toBeTruthy();
    expect(event.rawPayload).toEqual(payload);
  });

  it('maps capture to paid, expire to expired, and everything else to failed', async () => {
    const p = provider();
    const cases: Array<[string, string]> = [
      ['capture', 'paid'],
      ['settlement', 'paid'],
      ['expire', 'expired'],
      ['deny', 'failed'],
      ['cancel', 'failed'],
      ['pending', 'failed'],
    ];
    for (const [transactionStatus, expected] of cases) {
      const payload = await p.simulateWebhookPayload('ORDER-1', 10_000, transactionStatus);
      const event = await p.parseWebhook(webhookRequest(payload));
      expect(event.status, transactionStatus).toBe(expected);
    }
  });

  it('throws on a tampered signature rather than returning an unverified event', async () => {
    const p = provider();
    const payload = await p.simulateWebhookPayload('ORDER-1', 100_000);
    const tampered = { ...payload, signature_key: 'f'.repeat(128) };
    await expect(p.parseWebhook(webhookRequest(tampered))).rejects.toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('throws when the amount is altered after signing', async () => {
    const p = provider();
    const payload = await p.simulateWebhookPayload('ORDER-1', 10_000);
    // The attack this check exists for: settle a small charge as a large one.
    const inflated = { ...payload, gross_amount: '10000000.00' };
    await expect(p.parseWebhook(webhookRequest(inflated))).rejects.toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('throws when a payload signed for one provider key arrives at another', async () => {
    const attacker = new MockPaymentProvider({ serverKey: 'attacker-guessed-key' });
    const payload = await attacker.simulateWebhookPayload('ORDER-1', 100_000);
    await expect(provider().parseWebhook(webhookRequest(payload))).rejects.toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('throws on a payload with no signature at all', async () => {
    await expect(
      provider().parseWebhook(webhookRequest({ order_id: 'ORDER-1', transaction_status: 'settlement' })),
    ).rejects.toThrow(InvalidWebhookSignatureError);
  });
});

describe('createPayout', () => {
  it('returns a payout id derived from the reference', async () => {
    const result = await provider().createPayout({
      referenceId: 'PAYOUT-1',
      amount: 500_000,
      channelCode: 'ID_BCA',
      accountNumber: '1234567890',
      accountHolderName: 'Yayasan Indonesia Emas',
      description: 'Pencairan dana kampanye',
    });
    expect(result.payoutId).toContain('PAYOUT-1');
    expect(['pending', 'completed', 'failed']).toContain(result.status);
  });
});
