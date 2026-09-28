import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    refund: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    volunteerTrip: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import AdminRefundsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Ticket 23 (Rilis 1, narrowed scope): a REQUESTED Refund has nowhere else
 * to be seen and acted on. This is that queue's list half; /admin/refunds/[id]
 * is the detail/approve half, and /admin/refunds/new is the create half.
 */
describe('AdminRefundsPage', () => {
  it('lists a REQUESTED Campaign Refund, linking to its detail page', async () => {
    vi.mocked(prisma.refund.findMany).mockResolvedValue([
      {
        id: 'refund-1',
        amount: 250_000,
        reason: 'salah bayar',
        status: 'REQUESTED',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        requestedBy: { name: 'Admin Satu' },
        payment: { donation: { campaignId: 'campaign-1' }, registration: null },
      },
    ] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      { id: 'campaign-1', slug: 'wakaf-sumur', title: 'Wakaf Sumur' },
    ] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([] as never);

    render(await AdminRefundsPage());

    expect(screen.getByText(/menunggu persetujuan/i)).toBeDefined();
    const row = screen.getByText('Wakaf Sumur').closest('tr')!;
    expect(within(row).getByText('Admin Satu')).toBeDefined();
    expect(within(row).getByText(/Rp250\.000/)).toBeDefined();
    expect(within(row).getByText('salah bayar')).toBeDefined();
    const link = within(row).getByRole('link', { name: /tinjau/i });
    expect(link.getAttribute('href')).toBe('/admin/refunds/refund-1');
  });

  it('links to the create screen', async () => {
    vi.mocked(prisma.refund.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([] as never);

    render(await AdminRefundsPage());

    const link = screen.getByRole('link', { name: /buat refund/i });
    expect(link.getAttribute('href')).toBe('/admin/refunds/new');
  });

  it('shows an empty state in both queues when nothing is REQUESTED or APPROVED', async () => {
    vi.mocked(prisma.refund.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([] as never);

    render(await AdminRefundsPage());

    expect(screen.getAllByText(/tidak ada refund/i)).toHaveLength(2);
  });

  it('queries REQUESTED and APPROVED Refunds, ordered oldest first', async () => {
    vi.mocked(prisma.refund.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([] as never);

    await AdminRefundsPage();

    expect(prisma.refund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['REQUESTED', 'APPROVED'] } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('lists an APPROVED Refund under "Menunggu penyelesaian dengan bukti", linking to its detail page', async () => {
    vi.mocked(prisma.refund.findMany).mockResolvedValue([
      {
        id: 'refund-2',
        amount: 100_000,
        reason: 'x',
        status: 'APPROVED',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        requestedBy: { name: 'Admin Satu' },
        payment: { donation: { campaignId: 'campaign-1' }, registration: null },
      },
    ] as never);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      { id: 'campaign-1', slug: 'wakaf-sumur', title: 'Wakaf Sumur' },
    ] as never);
    vi.mocked(prisma.volunteerTrip.findMany).mockResolvedValue([] as never);

    render(await AdminRefundsPage());

    expect(screen.getByText(/menunggu penyelesaian dengan bukti/i)).toBeDefined();
    const row = screen.getByText('Wakaf Sumur').closest('tr')!;
    const link = within(row).getByRole('link', { name: /tinjau/i });
    expect(link.getAttribute('href')).toBe('/admin/refunds/refund-2');
  });
});
