import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  fundraisingPermitRow,
  kindAuthorisationRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../tests/support/in-memory-campaign-db';

/**
 * The ikrar confirmation checkout carries on a `wakaf` Campaign (CONTEXT.md,
 * Akad Wakaf; PRD user story 17): explicit, never assumed. POST
 * /api/donations refuses a `wakaf` Donation whose ikrarConfirmed is not
 * exactly true, before anything is written; every other Kind never requires it.
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

const FUTURE = new Date('2099-01-01T00:00:00Z');

function body(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: 'campaign-1',
    amount: 50_000,
    paymentMethod: 'qris',
    isAnonymous: false,
    guestEmail: 'wakif@example.com',
    ...overrides,
  };
}

function donate(overrides: Record<string, unknown> = {}): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/donations', {
      method: 'POST',
      body: JSON.stringify(body(overrides)),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function wakafCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    ...campaignRow({ lifecycleStatus: 'ACTIVE', kind: 'WAKAF', deadline: null, ...overrides }),
    isDemo: false,
  } as CampaignRow;
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
  holder.db = makeCampaignDb({
    campaigns: [wakafCampaign()],
    fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'] })],
    kindAuthorisations: [kindAuthorisationRow({ kind: 'WAKAF' })],
  });
});

describe('POST /api/donations and the ikrar confirmation (wakaf)', () => {
  it('refuses a `wakaf` Donation with no ikrarConfirmed, writing nothing', async () => {
    const response = await donate();

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.fieldErrors).toMatchObject({ ikrarConfirmed: expect.any(Array) });
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('refuses a `wakaf` Donation with ikrarConfirmed explicitly false, writing nothing', async () => {
    const response = await donate({ ikrarConfirmed: false });

    expect(response.status).toBe(400);
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('accepts a `wakaf` Donation once ikrarConfirmed is true, and persists it on the Donation', async () => {
    const response = await donate({ ikrarConfirmed: true });

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ikrarConfirmed: true }) }),
    );
  });

  it('never requires ikrarConfirmed on a non-`wakaf` Campaign', async () => {
    holder.db = makeCampaignDb({
      campaigns: [{ ...wakafCampaign({ kind: 'DONATION' }) }],
      fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'] })],
    });

    const response = await donate();

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ikrarConfirmed: false }) }),
    );
  });
});
