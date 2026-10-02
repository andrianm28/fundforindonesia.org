import { describe, it, expect, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Donor's own donation list carries the Receipt's token once one exists
 * (CONTEXT.md, Receipt), so the dashboard can link straight to the print
 * page -- never the full Receipt row, and never for a Donation that has not
 * Settled and so has no Receipt at all.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    donation: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

// Guest Donor history (prd-compliance 23): the claim has its own tests in
// src/lib/guest-donation-claim.test.ts; here only that this list asks for it.
vi.mock('@/lib/guest-donation-claim', () => ({
  claimGuestDonations: vi.fn().mockResolvedValue({ verified: true, claimed: 0 }),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { claimGuestDonations } from '@/lib/guest-donation-claim';
import { GET } from './route';

const mockClaim = claimGuestDonations as unknown as Mock;

const mockFindMany = prisma.donation.findMany as unknown as Mock;
const mockCount = prisma.donation.count as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function mineRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/donations/mine');
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'donation-1',
    amount: 100_000,
    paymentMethod: 'qris',
    paymentStatus: 'confirmed',
    isAnonymous: false,
    message: null,
    createdAt: new Date('2026-09-26T00:00:00.000Z'),
    campaign: { title: 'Test Campaign', slug: 'test-campaign', coverImage: '' },
    receipt: { token: 'tok-1' },
    akadWakaf: null,
    ...overrides,
  };
}

describe('GET /api/donations/mine', () => {
  it('requires a session', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(mineRequest());

    expect(response.status).toBe(401);
  });

  it("carries the Receipt's token for a settled Donation", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'donor-1' } });
    mockFindMany.mockResolvedValue([makeRow()]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.donations[0].receiptToken).toBe('tok-1');
  });

  it('carries no token for a Donation with no Receipt (not yet settled)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'donor-1' } });
    mockFindMany.mockResolvedValue([makeRow({ paymentStatus: 'pending', receipt: null })]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.donations[0].receiptToken).toBeNull();
  });

  it("carries the Akad Wakaf's token for a settled Donation on a `wakaf` Campaign (CONTEXT.md, Akad Wakaf)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'donor-1' } });
    mockFindMany.mockResolvedValue([makeRow({ akadWakaf: { token: 'akad-tok-1' } })]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.donations[0].akadWakafToken).toBe('akad-tok-1');
  });

  it("claims the account's guest history before listing, and says whether the address is verified", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'donor-1' } });
    mockClaim.mockResolvedValue({ verified: true, claimed: 2 });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(mockClaim).toHaveBeenCalledWith('donor-1');
    expect(mockClaim.mock.invocationCallOrder[0]).toBeLessThan(mockFindMany.mock.invocationCallOrder[0]);
    expect(data.emailVerified).toBe(true);
  });

  it('reports an unverified address so the page can offer the confirmation link', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'donor-1' } });
    mockClaim.mockResolvedValue({ verified: false, claimed: 0 });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const response = await GET(mineRequest());

    expect((await response.json()).emailVerified).toBe(false);
  });

  it('carries no Akad Wakaf token for a Donation on a non-`wakaf` Campaign', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'donor-1' } });
    mockFindMany.mockResolvedValue([makeRow()]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.donations[0].akadWakafToken).toBeNull();
  });
});
