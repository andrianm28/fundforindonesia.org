import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    manualContribution: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import AdminManualContributionsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Ticket 26: the Admin queue for a Manual Contribution's PENDING half --
 * money recorded by one Admin, waiting for a different one to decide
 * (CONTEXT.md, Manual Contribution). This is that screen's list half;
 * /admin/manual-contributions/[id] is the detail/decision half, and
 * /admin/manual-contributions/new is the record half -- the same
 * three-page shape /admin/payouts and /admin/refunds already use.
 */
describe('AdminManualContributionsPage', () => {
  it('lists a PENDING Campaign contribution, linking to its detail page', async () => {
    vi.mocked(prisma.manualContribution.findMany).mockResolvedValue([
      {
        id: 'mc-1',
        amount: 250_000,
        proofReference: 'bukti.pdf',
        status: 'PENDING',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        recordedBy: { name: 'Admin Satu' },
        campaign: { title: 'Wakaf Sumur' },
        program: null,
      },
    ] as never);

    render(await AdminManualContributionsPage());

    const row = screen.getByText('Wakaf Sumur').closest('tr')!;
    expect(within(row).getByText('Admin Satu')).toBeDefined();
    expect(within(row).getByText(/Rp250\.000/)).toBeDefined();
    const link = within(row).getByRole('link', { name: /tinjau/i });
    expect(link.getAttribute('href')).toBe('/admin/manual-contributions/mc-1');
  });

  it('lists a PENDING Program contribution by the Program title', async () => {
    vi.mocked(prisma.manualContribution.findMany).mockResolvedValue([
      {
        id: 'mc-2',
        amount: 100_000,
        proofReference: 'bukti.pdf',
        status: 'PENDING',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        recordedBy: { name: 'Admin Satu' },
        campaign: null,
        program: { title: 'Program Pendidikan' },
      },
    ] as never);

    render(await AdminManualContributionsPage());

    expect(screen.getByText('Program Pendidikan')).toBeDefined();
  });

  it('links to the record screen', async () => {
    vi.mocked(prisma.manualContribution.findMany).mockResolvedValue([] as never);

    render(await AdminManualContributionsPage());

    const link = screen.getByRole('link', { name: /catat manual contribution/i });
    expect(link.getAttribute('href')).toBe('/admin/manual-contributions/new');
  });

  it('shows an empty state when nothing is PENDING', async () => {
    vi.mocked(prisma.manualContribution.findMany).mockResolvedValue([] as never);

    render(await AdminManualContributionsPage());

    expect(screen.getByText(/tidak ada manual contribution/i)).toBeDefined();
  });

  it('queries only PENDING contributions, ordered oldest first', async () => {
    vi.mocked(prisma.manualContribution.findMany).mockResolvedValue([] as never);

    await AdminManualContributionsPage();

    expect(prisma.manualContribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });
});
