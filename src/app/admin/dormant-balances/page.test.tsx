import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/money/dormant-balances', () => ({
  dormantBalanceReport: vi.fn(),
}));

import { dormantBalanceReport } from '@/lib/money/dormant-balances';
import AdminDormantBalancesPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * The 60-day Dormant Balance report (ticket 24; PRD §7.3): "Campaign yang
 * Expired atau Completed dan masih memegang Campaign Balance muncul di
 * laporan Admin setelah 60 hari." Read-only for Admin -- no action here
 * reallocates or pays anything out, since that transfer is explicitly out
 * of Rilis 1 (CONTEXT.md, Dormant Balance).
 */
describe('AdminDormantBalancesPage', () => {
  it('lists a dormant Campaign with its status, days dormant, and balance', async () => {
    vi.mocked(dormantBalanceReport).mockResolvedValue([
      {
        campaignId: 'campaign-1',
        slug: 'sumur-desa',
        title: 'Sumur untuk Desa',
        status: 'EXPIRED',
        since: new Date('2026-07-29T00:00:00.000Z'),
        daysSince: 61,
        balance: 2_000_000,
      },
    ]);

    render(await AdminDormantBalancesPage());

    const row = screen.getByText('Sumur untuk Desa').closest('tr')!;
    expect(within(row).getByText(/expired/i)).toBeDefined();
    expect(within(row).getByText(/61/)).toBeDefined();
    expect(within(row).getByText(/Rp2\.000\.000/)).toBeDefined();
    const link = within(row).getByRole('link', { name: /sumur untuk desa/i });
    expect(link.getAttribute('href')).toBe('/campaign/sumur-desa');
  });

  it('shows an empty state when nothing is dormant', async () => {
    vi.mocked(dormantBalanceReport).mockResolvedValue([]);

    render(await AdminDormantBalancesPage());

    expect(screen.getByText(/tidak ada/i)).toBeDefined();
  });
});
