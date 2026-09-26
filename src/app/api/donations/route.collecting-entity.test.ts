import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  fundraisingPermitRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../tests/support/in-memory-campaign-db';

/**
 * The donation gate judged against the Collecting Entity (prd-compliance 10,
 * ADR 0010): an Active Campaign accepts a Donation only while its Collecting
 * Entity holds a Fundraising Permit valid now for its Kind. Judged lazily:
 * a lapsed permit refuses without anything being written.
 */

vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return { ...actual, donationsEnabled: () => true, sandboxInProductionReason: () => null };
});

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-campaign-db').makeCampaignDb>,
  donation: { create: null as unknown as Mock, update: null as unknown as Mock },
  payment: { create: null as unknown as Mock },
  prayer: { create: null as unknown as Mock },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key: string) {
        if (key === 'donation') return holder.donation;
        if (key === 'payment') return holder.payment;
        if (key === 'prayer') return holder.prayer;
        return (holder.db.prisma as Record<string, unknown>)[key];
      },
    },
  ),
}));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn(async () => null) }));

vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return { ...actual, getPaymentProvider: vi.fn() };
});

import { POST } from './route';
import { COLLECTING_ENTITY_REFUSAL } from '@/lib/campaign-page-status';
import { getPaymentProvider } from '@/lib/payments';

const FUTURE = new Date('2099-01-01T00:00:00Z');

const QRIS_BODY = {
  campaignId: 'campaign-1',
  amount: 50_000,
  paymentMethod: 'qris',
  isAnonymous: false,
};

function donate(): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/donations', {
      method: 'POST',
      body: JSON.stringify(QRIS_BODY),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function activeCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return { ...campaignRow({ lifecycleStatus: 'ACTIVE', ...overrides }), isDemo: false } as CampaignRow;
}

beforeEach(() => {
  holder.donation.create = vi.fn(async () => ({
    id: 'donation-1',
    amount: 50_000,
    paymentMethod: 'qris',
    paymentStatus: 'pending',
  }));
  holder.donation.update = vi.fn(async () => ({}));
  holder.payment.create = vi.fn(async () => ({}));
  holder.prayer.create = vi.fn(async () => ({}));
  (getPaymentProvider as unknown as Mock).mockReturnValue({
    name: 'sumopod',
    method: 'qris_redirect',
    createCharge: vi.fn(async () => ({
      providerOrderId: 'donation-1',
      method: 'qris_redirect',
      redirectUrl: 'https://pay.sumopod.com/pay/abc',
      expiresAt: FUTURE,
    })),
  });
});

const REFUSAL = {
  error: COLLECTING_ENTITY_REFUSAL,
};

describe('POST /api/donations and the Collecting Entity', () => {
  it('accepts a Donation while the Collecting Entity holds a permit valid now for the Kind', async () => {
    holder.db = makeCampaignDb({ campaigns: [activeCampaign({ deadline: FUTURE })] });

    const response = await donate();

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['names no Collecting Entity', { collectingEntityId: null }, undefined],
    [
      'collects under a permit that has lapsed',
      {},
      [fundraisingPermitRow({ validTo: new Date('2026-01-01T00:00:00Z') })],
    ],
    ['collects under a permit for other Kinds only', { kind: 'ZAKAT' as const }, [fundraisingPermitRow({ kinds: ['DONATION'] })]],
  ])('refuses a Campaign that %s with 403, writing nothing and recording nothing', async (_why, overrides, permits) => {
    holder.db = makeCampaignDb({
      campaigns: [activeCampaign({ deadline: FUTURE, ...overrides })],
      ...(permits && { fundraisingPermits: permits }),
    });

    const response = await donate();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(REFUSAL);
    expect(holder.donation.create).not.toHaveBeenCalled();
    expect(holder.payment.create).not.toHaveBeenCalled();
    expect(holder.db.campaign()).toMatchObject({ lifecycleStatus: 'ACTIVE' });
    expect(holder.db.statusChanges).toEqual([]);
  });
});
