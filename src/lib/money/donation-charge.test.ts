import { describe, it, expect, vi } from 'vitest';
import { chargeDonation } from './donation-charge';
import type { PaymentProvider } from '@/lib/payments';
import { UnknownPaymentProviderError } from '@/lib/payments/provider-names';

function makeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    payment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'payment-1', ...data })),
    },
    chargeWriteFailure: { create: vi.fn().mockResolvedValue({}) },
    platformFeeRule: { findFirst: vi.fn().mockResolvedValue(null) },
    platformFeeThreshold: { findFirst: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

const CAMPAIGN = { id: 'campaign-1', kind: 'DONATION' as const, category: 'kesehatan' };

function makeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    name: 'mock',
    method: 'qris_redirect',
    createCharge: vi.fn().mockResolvedValue({
      providerOrderId: 'order-1',
      method: 'qris_redirect',
      redirectUrl: 'https://pay.example/order-1',
      expiresAt: new Date('2099-01-02T00:00:00.000Z'),
    }),
    ...overrides,
  } as unknown as PaymentProvider;
}

describe('chargeDonation', () => {
  it('creates a PENDING Payment freezing the Platform Fee and Escrow Hold duration in force right now', async () => {
    const db = makeDb({
      platformFeeRule: {
        findFirst: vi.fn().mockResolvedValue({ percentBps: 500, setAt: new Date() }),
      },
    });
    const provider = makeProvider();

    const result = await chargeDonation({
      db: db as never,
      provider,
      campaign: CAMPAIGN,
      donationId: 'donation-1',
      amount: 100_000,
      orderId: 'donation-1',
      paymentMethod: 'qris_redirect',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.platformFee).toBe(5_000); // 5% of 100,000
    expect(db.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        donationId: 'donation-1',
        providerRef: 'donation-1',
        amount: 100_000,
        platformFee: 5_000,
        escrowHoldDays: 7,
        status: 'PENDING',
      }),
    });
  });

  it('refuses without writing anything when the wanted method is not what the provider serves', async () => {
    const db = makeDb();
    const provider = makeProvider({ method: 'qris_redirect' });

    const result = await chargeDonation({
      db: db as never,
      provider,
      campaign: CAMPAIGN,
      donationId: 'donation-1',
      amount: 100_000,
      orderId: 'donation-1',
      paymentMethod: 'bank_transfer_va',
    });

    expect(result).toEqual({ ok: false, reason: 'method_unavailable' });
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it('reports a provider failure without writing a Payment', async () => {
    const db = makeDb();
    const provider = makeProvider({ createCharge: vi.fn().mockRejectedValue(new Error('network down')) });

    const result = await chargeDonation({
      db: db as never,
      provider,
      campaign: CAMPAIGN,
      donationId: 'donation-1',
      amount: 100_000,
      orderId: 'donation-1',
      paymentMethod: 'qris_redirect',
    });

    expect(result).toEqual({ ok: false, reason: 'provider_error' });
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it('refuses a Payment whose method disagrees with what the provider actually charged', async () => {
    const db = makeDb();
    const provider = makeProvider({
      createCharge: vi.fn().mockResolvedValue({
        providerOrderId: 'order-1',
        method: 'bank_transfer_va',
        vaNumber: '123',
        expiresAt: new Date(),
      }),
    });

    const result = await chargeDonation({
      db: db as never,
      provider,
      campaign: CAMPAIGN,
      donationId: 'donation-1',
      amount: 100_000,
      orderId: 'donation-1',
      paymentMethod: 'qris_redirect',
    });

    expect(result).toEqual({ ok: false, reason: 'method_mismatch' });
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it('waives the Platform Fee below the Admin-set threshold, same as the frozen rule everywhere else', async () => {
    const db = makeDb({
      platformFeeRule: { findFirst: vi.fn().mockResolvedValue({ percentBps: 500, setAt: new Date() }) },
      platformFeeThreshold: { findFirst: vi.fn().mockResolvedValue({ amount: 50_000, setAt: new Date() }) },
    });
    const provider = makeProvider();

    const result = await chargeDonation({
      db: db as never,
      provider,
      campaign: CAMPAIGN,
      donationId: 'donation-1',
      amount: 30_000,
      orderId: 'donation-1',
      paymentMethod: 'qris_redirect',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.platformFee).toBe(0);
  });

  it('records the provider under the one name the registry knows, whatever the adapter calls itself', async () => {
    // `Payment.provider` is a join key, not a label: providerBalances groups by
    // exact string equality, and the reconciliation report is read per provider.
    // So an adapter that calls itself "SumoPod" and one that calls itself
    // "sumopod" have to land as the same value, or the same provider's money is
    // reported as two pots -- each reconciling exactly, against nothing.
    //
    // This was reachable because the registry locks the BUILDER KEYS, not the
    // adapters' `name` property: `readonly name = 'SumoPod'` compiles, and the
    // write took the string as it stood.
    for (const name of ['SumoPod', 'sumopod', 'MOCK']) {
      const db = makeDb();
      const provider = makeProvider({ name });

      const result = await chargeDonation({
        db: db as never,
        provider,
        campaign: CAMPAIGN,
        donationId: 'donation-1',
        amount: 100_000,
        orderId: 'donation-1',
        paymentMethod: 'qris_redirect',
      });

      expect(result.ok).toBe(true);
      expect(db.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ provider: name.toLowerCase() }),
      });
    }
  });

  it('refuses an adapter whose name names no provider, before a charge exists at one', async () => {
    // An adapter this build has no registered name for is a defect in the
    // build, not a donor's mistake, so it is loud rather than an answer: there
    // is no provider to name the row after, and a name that means nothing in
    // this column becomes a Provider Balance bucket no code can settle against.
    //
    // Before the charge, not after it. A charge created and then abandoned at
    // the provider is a live payment link a donor can still pay into with
    // nothing on this side expecting the money -- the reason the method check
    // below sits ahead of createCharge too.
    const db = makeDb();
    const provider = makeProvider({ name: 'zendesk' });

    await expect(
      chargeDonation({
        db: db as never,
        provider,
        campaign: CAMPAIGN,
        donationId: 'donation-1',
        amount: 100_000,
        orderId: 'donation-1',
        paymentMethod: 'qris_redirect',
      }),
    ).rejects.toBeInstanceOf(UnknownPaymentProviderError);

    expect(provider.createCharge).not.toHaveBeenCalled();
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it('records a ChargeWriteFailure and returns payment_write_failed when the charge succeeded but the Payment write failed (ticket 52)', async () => {
    const db = makeDb({ payment: { create: vi.fn().mockRejectedValue(new Error('connection reset')) } });

    const result = await chargeDonation({
      db: db as never,
      provider: makeProvider(),
      campaign: CAMPAIGN,
      donationId: 'donation-1',
      amount: 100_000,
      orderId: 'order-1',
      paymentMethod: 'qris_redirect',
    });

    expect(result).toEqual({ ok: false, reason: 'payment_write_failed' });
    expect(db.chargeWriteFailure.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'mock',
        providerRef: 'order-1',
        subjectType: 'donation',
        subjectId: 'donation-1',
        amount: 100_000,
      }),
    });
  });
});
