import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../tests/support/in-memory-campaign-db';

/**
 * The donation gate judged against the effective status.
 *
 * An Active Campaign whose deadline has passed is Expired whether or not
 * anyone has recorded that yet (CONTEXT.md, Campaign Status), and only
 * Active accepts a Donation. The Campaign side runs against the in-memory
 * Campaign db, so the lazy expiry the route triggers is observed in the rows
 * it leaves behind, exactly as the lifecycle tests observe it.
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
import { getPaymentProvider } from '@/lib/payments';

const PAST = new Date('2020-01-01T00:00:00Z');
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
  return { ...campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', ...overrides }), isDemo: false } as CampaignRow;
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

describe('POST /api/donations on an Active Campaign past its deadline', () => {
  it('refuses the Donation as it refuses any Expired Campaign, and writes no Donation or Payment', async () => {
    holder.db = makeCampaignDb({ campaigns: [activeCampaign({ deadline: PAST })] });

    const response = await donate();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.',
    });
    expect(holder.donation.create).not.toHaveBeenCalled();
    expect(holder.payment.create).not.toHaveBeenCalled();
    expect(holder.prayer.create).not.toHaveBeenCalled();
  });

  it('records the Campaign Expired (capacity SYSTEM) and tells the Fundraiser, though the Donation was refused', async () => {
    holder.db = makeCampaignDb({ campaigns: [activeCampaign({ deadline: PAST })] });

    await donate();

    expect(holder.db.campaign()).toMatchObject({ status: 'expired', lifecycleStatus: 'EXPIRED' });
    expect(holder.db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'EXPIRED',
        fromStatus: 'ACTIVE',
        toStatus: 'EXPIRED',
        actorId: null,
        capacity: 'SYSTEM',
      }),
    ]);
    expect(holder.db.notifications).toEqual([
      expect.objectContaining({ userId: 'creator-1', link: '/campaign/bantu-korban-banjir' }),
    ]);
  });
});

describe('POST /api/donations on an Active Campaign that has not expired', () => {
  it.each([
    ['a future deadline', FUTURE],
    ['no deadline (as every wakaf Campaign has)', null],
  ])('accepts the Donation for a Campaign with %s and records nothing', async (_label, deadline) => {
    holder.db = makeCampaignDb({ campaigns: [activeCampaign({ deadline })] });

    const response = await donate();

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledTimes(1);
    expect(holder.payment.create).toHaveBeenCalledTimes(1);
    expect(holder.db.campaign()).toMatchObject({ lifecycleStatus: 'ACTIVE' });
    expect(holder.db.statusChanges).toEqual([]);
    expect(holder.db.notifications).toEqual([]);
  });
});
