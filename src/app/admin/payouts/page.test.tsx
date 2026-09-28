import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payout: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    volunteerTrip: { findMany: vi.fn() },
    payoutBalanceCheck: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import AdminPayoutsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // ticket 30: no unresolved short checks unless a test says otherwise.
  vi.mocked(prisma.payoutBalanceCheck.findMany).mockResolvedValue([] as never);
});

/**
 * The Admin queue ticket 21 asks for: a Payout raised through the product
 * has nowhere else to be seen and acted on (map.md, "No Admin panel for
 * Payouts"). Two groups, DRAFT ("menunggu persetujuan") and APPROVED
 * ("menunggu penyelesaian"), because those are the only two states an Admin
 * has anything to do about -- anything else has already been decided.
 */
describe('AdminPayoutsPage', () => {
  it('lists a DRAFT Campaign Payout under "menunggu persetujuan", linking to its detail page', async () => {
    vi.mocked(prisma.payout.findMany).mockResolvedValue([
      {
        id: 'payout-1',
        campaignId: 'campaign-1',
        volunteerTripId: null,
        amount: 5_000_000,
        description: 'Untuk material sumur',
        status: 'DRAFT',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        requestedBy: { name: 'Budi' },
        bankAccount: { bankCode: 'BCA', accountName: 'Budi Santoso' },
      },
    ] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      { id: 'campaign-1', slug: 'sumur-desa', title: 'Sumur untuk Desa' },
    ] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([] as never);

    render(await AdminPayoutsPage());

    expect(screen.getByText(/menunggu persetujuan/i)).toBeDefined();
    const row = screen.getByText('Sumur untuk Desa').closest('tr')!;
    expect(within(row).getByText('Budi')).toBeDefined();
    expect(within(row).getByText(/Rp5\.000\.000/)).toBeDefined();
    const link = within(row).getByRole('link', { name: /tinjau/i });
    expect(link.getAttribute('href')).toBe('/admin/payouts/payout-1');
  });

  it('lists an APPROVED Volunteer Trip Payout under "menunggu penyelesaian"', async () => {
    vi.mocked(prisma.payout.findMany).mockResolvedValue([
      {
        id: 'payout-2',
        campaignId: null,
        volunteerTripId: 'trip-1',
        amount: 2_000_000,
        description: 'Trip fee payout',
        status: 'APPROVED',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        requestedBy: { name: 'Siti' },
        bankAccount: { bankCode: 'BNI', accountName: 'Siti Aminah' },
      },
    ] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([
      { id: 'trip-1', slug: 'trip-lombok', title: 'Trip ke Lombok' },
    ] as never);

    render(await AdminPayoutsPage());

    expect(screen.getByText(/menunggu penyelesaian/i)).toBeDefined();
    const row = screen.getByText('Trip ke Lombok').closest('tr')!;
    expect(within(row).getByText('Siti')).toBeDefined();
  });

  it('marks a DRAFT Payout that has an unresolved short balance check (ticket 30)', async () => {
    vi.mocked(prisma.payout.findMany).mockResolvedValue([
      {
        id: 'payout-1',
        campaignId: 'campaign-1',
        volunteerTripId: null,
        amount: 5_000_000,
        description: 'Untuk material sumur',
        status: 'DRAFT',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        requestedBy: { name: 'Budi' },
        bankAccount: { bankCode: 'BCA', accountName: 'Budi Santoso' },
      },
    ] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      { id: 'campaign-1', slug: 'sumur-desa', title: 'Sumur untuk Desa' },
    ] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payoutBalanceCheck.findMany).mockResolvedValue([{ payoutId: 'payout-1' }] as never);

    render(await AdminPayoutsPage());

    const row = screen.getByText('Sumur untuk Desa').closest('tr')!;
    expect(within(row).getByText(/menunggu saldo penyedia/i)).toBeDefined();
  });

  it('says so when a queue is empty rather than showing an empty table', async () => {
    vi.mocked(prisma.payout.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([] as never);

    render(await AdminPayoutsPage());

    expect(screen.getAllByText(/tidak ada payout/i).length).toBeGreaterThan(0);
  });
});
