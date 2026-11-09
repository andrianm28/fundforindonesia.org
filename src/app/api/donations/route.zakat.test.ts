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
 * A zakat checkout rides the existing donation path (PKS pemenuhan 19, ADR
 * 0028): a Campaign of Kind ZAKAT, gated like every other Kind by the
 * Collecting Entity's permit and Kind Authorisation, and in addition by the
 * module's own switch and recipient. No new money path: a refused checkout
 * writes nothing.
 */

vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return { ...actual, donationsEnabled: () => true, sandboxInProductionReason: () => null };
});

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-campaign-db').makeCampaignDb>,
  operations: null as unknown,
  donation: { create: null as unknown as Mock, update: null as unknown as Mock },
  payment: { create: null as unknown as Mock },
  prayer: { create: null as unknown as Mock },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key: string) {
        if (key === 'siteSetting') {
          return { findUnique: async () => (holder.operations ? { key: 'operations', value: holder.operations, updatedAt: new Date(1) } : null) };
        }
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

function operations(zakat: { enabled: boolean; nisabAmount: number; recipientOrganisationId: string | null }) {
  return {
    donationsOpen: true,
    maintenance: { on: false, message: '' },
    zakat,
    history: [],
  };
}
const ZAKAT_ON = operations({ enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'partner-1' });

function zakatCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    ...campaignRow({ lifecycleStatus: 'ACTIVE', kind: 'ZAKAT', deadline: FUTURE, ...overrides }),
    isDemo: false,
  } as CampaignRow;
}

const licensed = {
  fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT'] })],
  kindAuthorisations: [kindAuthorisationRow({ kind: 'ZAKAT' })],
};

function donate(): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/donations', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: 'campaign-1',
        amount: 250_000,
        paymentMethod: 'qris',
        isAnonymous: false,
        guestEmail: 'muzaki@example.com',
      }),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  holder.operations = null;
  holder.donation.create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'donation-1',
    amount: args.data.amount,
    paymentMethod: args.data.paymentMethod,
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

describe('POST /api/donations for a zakat Campaign', () => {
  it('answers 404 as if the Campaign did not exist while the module is OFF (the default), and writes nothing', async () => {
    holder.db = makeCampaignDb({ campaigns: [zakatCampaign()], ...licensed });

    const response = await donate();

    expect(response.status).toBe(404);
    expect(holder.donation.create).not.toHaveBeenCalled();
    expect(holder.payment.create).not.toHaveBeenCalled();
  });

  it('answers 404 when the switch is off even though a recipient is configured', async () => {
    holder.operations = operations({ enabled: false, nisabAmount: 85_000_000, recipientOrganisationId: 'partner-1' });
    holder.db = makeCampaignDb({ campaigns: [zakatCampaign()], ...licensed });

    expect((await donate()).status).toBe(404);
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('takes the Donation once the module is ON and the Campaign collects under the configured recipient', async () => {
    holder.operations = ZAKAT_ON;
    holder.db = makeCampaignDb({ campaigns: [zakatCampaign()], ...licensed });

    const response = await donate();

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a zakat Campaign that collects under anyone but the configured recipient', async () => {
    holder.operations = operations({ enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'partner-2' });
    holder.db = makeCampaignDb({ campaigns: [zakatCampaign()], ...licensed });

    const response = await donate();

    expect(response.status).toBe(403);
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('still needs the Kind Authorisation for zakat: the module being ON does not replace the licence', async () => {
    holder.operations = ZAKAT_ON;
    holder.db = makeCampaignDb({
      campaigns: [zakatCampaign()],
      fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT'] })],
      kindAuthorisations: [],
    });

    expect((await donate()).status).toBe(403);
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('does not touch a general donation: a DONATION Campaign is taken whatever the zakat switch says', async () => {
    holder.operations = null;
    holder.db = makeCampaignDb({
      campaigns: [{ ...zakatCampaign({ kind: 'DONATION' }) }],
      fundraisingPermits: [fundraisingPermitRow()],
    });

    expect((await donate()).status).toBe(201);
  });
});
