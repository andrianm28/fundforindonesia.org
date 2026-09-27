import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  fundraisingPermitRow,
  kindAuthorisationRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../tests/support/in-memory-campaign-db';
import { COLLECTING_ENTITY_REFUSAL } from '@/lib/campaign-page-status';

/**
 * Ticket 02 (docs/adr/0013-hibah-as-fourth-kind.md; CONTEXT.md, Hibah): a
 * `hibah` Campaign rides the exact same Kind-generic machinery `zakat` and
 * `wakaf` already ride through POST /api/donations -- the Kind Authorisation
 * gate, and a Donor Hibah's nominal, Receipt and anonymity choices, through
 * the same route seam route.collecting-entity.test.ts and
 * route.ikrar-wakaf.test.ts already exercise for other Kinds. Nothing new is
 * built here: this pins the behaviour for `hibah` specifically.
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
import { readDonationGuestEmail, readDonationGuestPhone } from '@/lib/contact-fields';
import { getPaymentProvider } from '@/lib/payments';

const FUTURE = new Date('2099-01-01T00:00:00Z');

function hibahCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    ...campaignRow({ lifecycleStatus: 'ACTIVE', kind: 'HIBAH', deadline: FUTURE, ...overrides }),
    isDemo: false,
  } as CampaignRow;
}

function donate(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/donations', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
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

describe('POST /api/donations for a hibah Campaign, gated by Kind Authorisation (ADR 0013)', () => {
  it('refuses a Donation while the Collecting Entity holds a permit but no Kind Authorisation for hibah', async () => {
    holder.db = makeCampaignDb({
      campaigns: [hibahCampaign()],
      fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'] })],
      kindAuthorisations: [],
    });

    const response = await donate({
      campaignId: 'campaign-1',
      amount: 100_000,
      paymentMethod: 'qris',
      isAnonymous: false,
      guestEmail: 'donor@example.com',
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: COLLECTING_ENTITY_REFUSAL });
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('refuses a Donation whose Collecting Entity holds a Kind Authorisation for another Kind only', async () => {
    holder.db = makeCampaignDb({
      campaigns: [hibahCampaign()],
      fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'] })],
      kindAuthorisations: [kindAuthorisationRow({ kind: 'WAKAF' })],
    });

    const response = await donate({
      campaignId: 'campaign-1',
      amount: 100_000,
      paymentMethod: 'qris',
      isAnonymous: false,
      guestEmail: 'donor@example.com',
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: COLLECTING_ENTITY_REFUSAL });
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('accepts a Donation once the Collecting Entity holds a valid Kind Authorisation for hibah', async () => {
    holder.db = makeCampaignDb({
      campaigns: [hibahCampaign()],
      fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'] })],
      kindAuthorisations: [kindAuthorisationRow({ kind: 'HIBAH' })],
    });

    const response = await donate({
      campaignId: 'campaign-1',
      amount: 100_000,
      paymentMethod: 'qris',
      isAnonymous: false,
      guestEmail: 'donor@example.com',
    });

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a hibah Donation once the Kind Authorisation has lapsed, even holding a valid permit', async () => {
    holder.db = makeCampaignDb({
      campaigns: [hibahCampaign()],
      fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'] })],
      kindAuthorisations: [kindAuthorisationRow({ kind: 'HIBAH', validTo: new Date('2026-01-01T00:00:00Z') })],
    });

    const response = await donate({
      campaignId: 'campaign-1',
      amount: 100_000,
      paymentMethod: 'qris',
      isAnonymous: false,
      guestEmail: 'donor@example.com',
    });

    expect(response.status).toBe(403);
    expect(holder.donation.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/donations, a Donor Hibah gets the same nominal, Receipt and anonymity choices as any other Donor', () => {
  beforeEach(() => {
    holder.db = makeCampaignDb({
      campaigns: [hibahCampaign()],
      fundraisingPermits: [fundraisingPermitRow({ kinds: ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'] })],
      kindAuthorisations: [kindAuthorisationRow({ kind: 'HIBAH' })],
    });
  });

  it('accepts a free nominal, above the Rp20.000 minimum, exactly as any Kind does', async () => {
    const response = await donate({
      campaignId: 'campaign-1',
      amount: 1_234_000,
      paymentMethod: 'qris',
      isAnonymous: false,
      guestEmail: 'donor@example.com',
    });

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 1_234_000, campaignId: 'campaign-1' }) }),
    );
  });

  it('refuses a nominal below the Rp20.000 minimum, same as any other Kind', async () => {
    const response = await donate({
      campaignId: 'campaign-1',
      amount: 19_999,
      paymentMethod: 'qris',
      isAnonymous: false,
      guestEmail: 'donor@example.com',
    });

    expect(response.status).toBe(400);
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('keeps the guest contact details a Receipt needs, for a Guest Donor Hibah', async () => {
    const response = await donate({
      campaignId: 'campaign-1',
      amount: 100_000,
      paymentMethod: 'qris',
      isAnonymous: false,
      guestEmail: 'donor-hibah@example.com',
      guestName: 'Donor Hibah',
      guestPhone: '081200000000',
    });

    expect(response.status).toBe(201);
    // Sealed, not plaintext (ADR 0012): what a Receipt later decrypts to reach
    // the Donor. The name stays in the clear, by decision.
    const { data } = holder.donation.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    const sealed = data as unknown as Parameters<typeof readDonationGuestEmail>[0] &
      Parameters<typeof readDonationGuestPhone>[0];
    expect(data).toMatchObject({ donorId: null, guestName: 'Donor Hibah' });
    expect(data).not.toHaveProperty('guestEmail');
    expect(readDonationGuestEmail(sealed)).toBe('donor-hibah@example.com');
    expect(readDonationGuestPhone(sealed)).toBe('081200000000');
  });

  it('refuses a Guest Donor Hibah who left no email, before anything is written', async () => {
    const response = await donate({
      campaignId: 'campaign-1',
      amount: 100_000,
      paymentMethod: 'qris',
      isAnonymous: false,
    });

    expect(response.status).toBe(400);
    expect(holder.donation.create).not.toHaveBeenCalled();
  });

  it('honours the anonymity choice, same as any other Kind', async () => {
    const response = await donate({
      campaignId: 'campaign-1',
      amount: 100_000,
      paymentMethod: 'qris',
      isAnonymous: true,
      guestEmail: 'donor@example.com',
    });

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isAnonymous: true }) }),
    );
  });

  it('never requires an ikrar confirmation on a hibah Campaign, unlike wakaf', async () => {
    const response = await donate({
      campaignId: 'campaign-1',
      amount: 100_000,
      paymentMethod: 'qris',
      isAnonymous: false,
      guestEmail: 'donor@example.com',
    });

    expect(response.status).toBe(201);
    expect(holder.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ikrarConfirmed: false }) }),
    );
  });
});
