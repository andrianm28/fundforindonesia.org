import { describe, it, expect, vi } from 'vitest';
import { chargeDonation, MerchantMismatchError } from './donation-charge';
import type { PaymentProvider } from '@/lib/payments';

/**
 * pks-pemenuhan/04, scope 2: a donation is charged on YAYASAN and recorded as
 * such; a provider bound to BADAN_USAHA is refused BEFORE any charge exists.
 */

function makeDb() {
  return {
    payment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'payment-1', ...data })),
    },
    chargeWriteFailure: { create: vi.fn().mockResolvedValue({}) },
    platformFeeRule: { findFirst: vi.fn().mockResolvedValue(null) },
    platformFeeThreshold: { findFirst: vi.fn().mockResolvedValue(null) },
    escrowHoldSetting: { findFirst: vi.fn().mockResolvedValue(null) },
  };
}

const CAMPAIGN = { id: 'campaign-1', kind: 'DONATION' as const, category: 'kesehatan' };

function makeProvider(merchant?: 'YAYASAN' | 'BADAN_USAHA') {
  return {
    name: 'sumopod',
    method: 'qris_redirect',
    merchant,
    createCharge: vi.fn().mockResolvedValue({
      providerOrderId: 'order-1',
      method: 'qris_redirect',
      redirectUrl: 'https://pay.example/order-1',
      expiresAt: new Date('2099-01-02T00:00:00.000Z'),
    }),
  } as unknown as PaymentProvider;
}

const params = (db: ReturnType<typeof makeDb>, provider: PaymentProvider) => ({
  db: db as never,
  provider,
  campaign: CAMPAIGN,
  donationId: 'donation-1',
  amount: 100_000,
  orderId: 'donation-1',
  paymentMethod: 'qris_redirect' as const,
});

describe('chargeDonation and the merchant entity', () => {
  it('records the Payment under YAYASAN', async () => {
    const db = makeDb();
    const result = await chargeDonation(params(db, makeProvider('YAYASAN')));
    expect(result.ok).toBe(true);
    expect(db.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ merchantEntity: 'YAYASAN' }) });
  });

  it('records YAYASAN for an adapter with no merchants (the mock)', async () => {
    const db = makeDb();
    await chargeDonation(params(db, makeProvider(undefined)));
    expect(db.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ merchantEntity: 'YAYASAN' }) });
  });

  it('refuses a provider bound to BADAN_USAHA before charging anything and writes nothing', async () => {
    const db = makeDb();
    const provider = makeProvider('BADAN_USAHA');
    await expect(chargeDonation(params(db, provider))).rejects.toThrow(MerchantMismatchError);
    expect(provider.createCharge).not.toHaveBeenCalled();
    expect(db.payment.create).not.toHaveBeenCalled();
  });
});
